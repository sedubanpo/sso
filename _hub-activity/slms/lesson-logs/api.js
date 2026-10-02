const { isDeepStrictEqual } = require('node:util');
'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { randomUUID } = require('node:crypto');
const { monthsBetween, publishedLessons, applySentChanges, normalizeLesson, normalizeNotionPage, resolveTeacherAccounts, compareLessons } = require('./core');

const NOTION_DATABASE_ID = process.env.NOTION_LESSON_LOG_DATABASE_ID || '1d1d8b6280e780398178ddaf80671b88';
const NOTION_DATA_SOURCE_ID = process.env.NOTION_LESSON_LOG_DATA_SOURCE_ID;
const NOTION_VERSION = '2025-09-03';
const MAX_DOCS_PER_MONTH = 2000;
const MAX_MIRROR_PAGES = 10000;
const SYNC_FRESH_MS = 2 * 60 * 60 * 1000;

function fail(code, message) { throw new HttpsError(code, message); }
function active(value) { return !!value && value.active !== false && value.isActive !== false && !value.disabled && !value.deletedAt && !value.retiredAt && !value.terminationDate; }

async function actor(db, uid) {
  if (!uid) fail('unauthenticated', '로그인이 필요합니다.');
  const refs = ['users', 'userProfiles', 'userAppAccess'].map(name => db.collection(name).doc(uid));
  const snapshots = await db.getAll(...refs);
  const [user, profile, access] = snapshots.map(snapshot => snapshot.data() || {});
  if (snapshots.some(snapshot => !snapshot.exists) || user.status !== 'ACTIVE' || !active(user) || !active(profile) || !active(access) || access.apps?.sLms !== true || !['ADMIN', 'STAFF', 'DESK', 'INSTRUCTOR'].includes(user.role)) fail('permission-denied', '활성 S-LMS 계정이 필요합니다.');
  const reminder = require('./consultation-reminders');
  return { uid, name: user.name || profile.displayName || uid, staff: user.role !== 'INSTRUCTOR', admin: user.role === 'ADMIN', identifiers: reminder.identifiers(uid,user,profile), reminderEligible: reminder.active(user) && reminder.active(profile) && reminder.active(access) };
}

async function teacherAccounts(db) {
  const snapshot = await db.collection('users').where('role', '==', 'INSTRUCTOR').limit(1001).get();
  if (snapshot.size > 1000) fail('resource-exhausted', '강사 계정 조회 한도를 초과했습니다.');
  const accounts = [];
  for (let offset = 0; offset < snapshot.docs.length; offset += 100) {
    const chunk = snapshot.docs.slice(offset, offset + 100);
    const [profiles, accesses] = await Promise.all([
      db.getAll(...chunk.map(doc => db.collection('userProfiles').doc(doc.id))),
      db.getAll(...chunk.map(doc => db.collection('userAppAccess').doc(doc.id))),
    ]);
    chunk.forEach((doc, index) => {
      const user = doc.data() || {}, profile = profiles[index].data() || {}, access = accesses[index].data() || {};
      if (user.status === 'ACTIVE' && active(user) && profiles[index].exists && active(profile) && accesses[index].exists && active(access) && access.apps?.sLms === true && user.name) accounts.push({ uid: doc.id, name: user.name, department: String(profile.department || user.department || '').slice(0, 40), accountHint: String(user.loginId || '').length >= 6 ? String(user.loginId).slice(-4) : '' });
    });
  }
  return accounts;
}

async function teacherDecisions(db, months) {
  const results = new Map();
  for (const month of months) {
    const snapshot = await db.collection('lessonLogTeacherDecisions').where('month', '==', month).limit(2001).get();
    if (snapshot.size > 2000) fail('resource-exhausted', '강사 연결 검토 기록이 조회 한도를 초과했습니다.');
    snapshot.docs.forEach(doc => results.set(doc.id, doc.data()));
  }
  return results;
}

async function sourceLessons(db, months, start, end, teacherUid = null, accounts = [], decisions = new Map(), requestedStudentId = null, includeStudentDetails = true) {
  const candidates = [];
  for (const month of months) {
    const [periods, histories, sentEvents] = await Promise.all([
      ...['intranetStudentPeriods', 'intranetLegacyPeriods'].map(name => db.collection(name).where(requestedStudentId ? 'studentId' : 'month', '==', requestedStudentId || month).limit(MAX_DOCS_PER_MONTH + 1).get()),
      db.collection('intranetPortalChanges').where('month', '==', month).limit(5001).get(),
    ]);
    if (periods.size > MAX_DOCS_PER_MONTH || histories.size > MAX_DOCS_PER_MONTH || sentEvents.size > 5000) fail('resource-exhausted', '해당 월의 수업이 조회 한도를 초과했습니다.');
    const events = sentEvents.docs.map(doc => doc.data());
    const inMonth = doc => doc.data().month === month && (!requestedStudentId || doc.data().studentId === requestedStudentId);
    const current = new Map(periods.docs.filter(inMonth).map(doc => [doc.data().studentId, { id: doc.id, ...doc.data() }]));
    const history = new Map(histories.docs.filter(inMonth).map(doc => [doc.data().studentId, { id: doc.id, ...doc.data() }]));
    const ids = [...new Set([...current.keys(), ...history.keys()].filter(Boolean))];
    for (const studentId of ids) {
      const period = current.get(studentId) || {};
      const old = history.get(studentId) || {};
      const periodKey = current.get(studentId)?.id || old.id || `${month}|${studentId}`;
      const oldLessons = old.lessons || old.publishedLessons || [];
      const effective = applySentChanges(publishedLessons(period, oldLessons), events, studentId, period.publishedDeletedIds || []);
      for (const lesson of effective) {
        const row = normalizeLesson(lesson, studentId, '', periodKey);
        if (row && row.classDate >= start && row.classDate <= end) candidates.push(row);
      }
    }
  }
  const blocked = teacherUid ? ((await db.collection('studentPermissionPolicyStates').doc(teacherUid).get()).data()?.revokedStudentIds || []) : [];
  const resolved = resolveTeacherAccounts(candidates, accounts, decisions).filter(row => (!teacherUid || row.teacherUid === teacherUid) && !blocked.includes(row.studentId));
  if (!includeStudentDetails) return resolved;
  const studentIds = [...new Set(resolved.map(row => row.studentId))];
  const students = new Map();
  for (let offset = 0; offset < studentIds.length; offset += 100) {
    const chunk = studentIds.slice(offset, offset + 100);
    const snapshots = await db.getAll(...chunk.map(id => db.collection('students').doc(id)));
    snapshots.forEach((doc, index) => {
      const student = doc.data() || {};
      students.set(chunk[index], { name: student.name || student.studentName || '', school: student.school || '', grade: student.grade || '' });
    });
  }
  return resolved.map(row => ({ ...row, studentName: students.get(row.studentId)?.name || row.studentName, studentSchool: students.get(row.studentId)?.school || '', studentGrade: students.get(row.studentId)?.grade || '' })).sort((a, b) => b.classDate.localeCompare(a.classDate) || b.start.localeCompare(a.start) || a.id.localeCompare(b.id));
}

function seoulToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function jikboLessons(db, who, input) {
  const today = seoulToday(), month = today.slice(0, 7);
  const recent = input.action === 'studentRecentLessons';
  const studentId = recent ? String(input.studentId || '') : null;
  if (recent && (!studentId || studentId.length > 200 || /[\/\x00-\x1f]/.test(studentId))) fail('invalid-argument', '학생을 선택해 주세요.');
  const start = new Date(Date.parse(today + 'T00:00:00Z') - (recent ? 27 : 20) * 86400000).toISOString().slice(0, 10);
  const end = today;
  const months = monthsBetween(start, end);
  const [accounts, decisions] = who.staff ? [[], new Map()] : await Promise.all([teacherAccounts(db), teacherDecisions(db, months)]);
  const rows = await sourceLessons(db, months, start, end, who.staff ? null : who.uid, accounts, decisions, studentId, false);
  if (recent) return { studentId, start, end, source: 'intranet-published', rows: rows.map(row => ({ id: row.id, subject: row.subject, teacherName: row.teacherName, classDate: row.classDate, start: row.start, end: row.end, minutes: row.minutes, kind: row.kind })) };
  const subjects = new Map();
  for (const row of rows) {
    if (!['regular', 'late'].includes(row.kind) || !row.subject) continue;
    if (!subjects.has(row.studentId)) subjects.set(row.studentId, new Set());
    subjects.get(row.studentId).add(row.subject);
  }
  return { month, start, end, windowDays: 21, source: 'intranet-published', students: [...subjects].map(([studentId, values]) => ({ studentId, subjects: [...values].sort((a, b) => a.localeCompare(b, 'ko')) })) };
}

async function studentCourses(db, who, input) {
  const studentId = String(input.studentId || '');
  if (!studentId || studentId.length > 200 || /[\/\x00-\x1f]/.test(studentId)) fail('invalid-argument', '학생을 선택해 주세요.');
  const end = seoulToday(), month = end.slice(0, 7);
  const start = new Date(Date.parse(end + 'T00:00:00Z') - 20 * 86400000).toISOString().slice(0, 10);
  const months = monthsBetween(start, end);
  const [accounts, decisions] = who.staff ? [[], new Map()] : await Promise.all([teacherAccounts(db), teacherDecisions(db, months)]);
  const lessons = await sourceLessons(db, months, start, end, who.staff ? null : who.uid, accounts, decisions, studentId);
  const courses = new Map();
  for (const lesson of lessons) {
    if (!['regular', 'late'].includes(lesson.kind) || !lesson.teacherName) continue;
    const key = `${lesson.teacherUid || lesson.teacherName}|${lesson.subject}`;
    courses.set(key, { teacherUid: lesson.teacherUid || '', teacherName: lesson.teacherName, subject: lesson.subject || '과목 미지정' });
  }
  return { studentId, month, start, end, windowDays: 21, source: 'intranet-published', courses: [...courses.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'ko') || a.teacherName.localeCompare(b.teacherName, 'ko')) };
}

async function mirrorPages(db, start, end) {
  const snapshot = await db.collection('lessonLogNotionPages').where('classDate', '>=', start).where('classDate', '<=', end).limit(MAX_MIRROR_PAGES + 1).get();
  if (snapshot.size > MAX_MIRROR_PAGES) fail('resource-exhausted', 'Notion 기록이 조회 한도를 초과했습니다.');
  return snapshot.docs.map(doc => doc.data());
}

async function list(db, who, input) {
  const start = String(input.start || '');
  const end = String(input.end || '');
  let months;
  try { months = monthsBetween(start, end); }
  catch (error) { fail('invalid-argument', error.message); }
  const [accounts, decisions] = await Promise.all([teacherAccounts(db), teacherDecisions(db, months)]);
  const visible = await sourceLessons(db, months, start, end, who.staff ? null : who.uid, accounts, decisions);
  const state = (await db.collection('lessonLogSyncState').doc('notion').get()).data() || {};
  const lastSuccess = state.lastSuccessAt?.toDate?.() || null;
  const connected = !!lastSuccess && !state.error && (!state.syncing || state.syncPhase === 'fetching') && Date.now() - lastSuccess.getTime() < SYNC_FRESH_MS;
  const pages = connected ? await mirrorPages(db, start, end) : [];
  const rows = compareLessons(visible, pages, connected);
  if (connected) {
    const pageById = new Map(pages.map(page => [page.id, page]));
    const ids = [...new Set(rows.map(row => row.notionId).filter(Boolean))];
    const scores = new Map();
    for (let offset = 0; offset < ids.length; offset += 300) {
      const chunk = ids.slice(offset, offset + 300);
      const snapshots = await db.getAll(...chunk.map(id => db.collection('lessonLogBodyScores').doc(id)));
      snapshots.forEach((snapshot, index) => {
        const data = snapshot.data();
        if (data && data.editedAt === pageById.get(chunk[index])?.editedAt && Number.isInteger(data.charCount)) scores.set(chunk[index], data.charCount);
      });
    }
    rows.forEach(row => {
      if (row.notionId && scores.has(row.notionId)) {
        row.bodyCharCount = scores.get(row.notionId);
        row.bodyScore = bodyScore(row.bodyCharCount);
      }
    });
  }
  return {
    rows,
    staff: who.staff,
    admin: who.admin,
    teacherReview: who.admin ? visible.filter(row => row.teacherMatch === 'ambiguous').map(row => ({ id: row.id, teacherName: row.teacherName, studentName: row.studentName, classDate: row.classDate, start: row.start, subject: row.subject, teacherCandidates: row.teacherCandidates })) : undefined,
    autoLinkedCount: who.staff ? visible.filter(row => row.teacherMatch === 'name').length : undefined,
    source: connected ? 'connected' : state.error ? 'error' : lastSuccess ? 'stale' : 'not-connected',
    lastSyncedAt: lastSuccess?.toISOString() || null,
    syncing: !!state.syncing,
    syncPhase: state.syncPhase || null,
    sourceCount: visible.length,
    // Unknown teacher UIDs are deliberately omitted from instructor results.
    unassignedCount: who.staff ? visible.filter(row => !row.teacherUid).length : 0,
    incompleteNotionCount: who.staff ? Number(state.incompleteCount || 0) : undefined,
  };
}

async function resolveTeacher(db, who, input) {
  if (!who.admin) fail('permission-denied', '강사 연결 검토는 관리자만 할 수 있습니다.');
  const start = String(input.start || ''), end = String(input.end || '');
  let months;
  try { months = monthsBetween(start, end); } catch (error) { fail('invalid-argument', error.message); }
  const lessonId = String(input.lessonId || ''), teacherUid = String(input.teacherUid || '');
  if (!lessonId || lessonId.length > 240 || !teacherUid || teacherUid.length > 128) fail('invalid-argument', '수업과 강사 계정을 선택해 주세요.');
  const [accounts, decisions] = await Promise.all([teacherAccounts(db), teacherDecisions(db, months)]);
  const rows = await sourceLessons(db, months, start, end, null, accounts, decisions);
  const row = rows.find(item => item.id === lessonId && item.teacherMatch === 'ambiguous');
  if (!row || !row.teacherCandidates.some(item => item.uid === teacherUid)) fail('failed-precondition', '검토 대상 수업이나 강사 계정이 변경되었습니다. 새로고침 후 다시 선택해 주세요.');
  await db.collection('lessonLogTeacherDecisions').doc(lessonId).set({ teacherUid, teacherName: row.teacherName, month: row.classDate.slice(0, 7), reviewedBy: who.uid, reviewedAt: new Date() });
  return { saved: true };
}

async function notionRequest(token, endpoint, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(endpoint, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 429 && attempt < 3) {
      const seconds = Math.min(Number(response.headers.get('retry-after')) || 1, 10);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      continue;
    }
    if (!response.ok) throw Error(`Notion 수업일지 조회 실패 (${response.status}). DB 공유 권한과 ID를 확인해 주세요.`);
    return response.json();
  }
  throw Error('Notion 요청 제한이 계속되고 있습니다.');
}

function bodyScore(count) { return count === 0 ? 0 : Math.min(5, Math.floor(count / 100) + 1); }
function blockText(block) {
  const content = block && block[block.type] || {};
  const rich = Array.isArray(content.rich_text) ? content.rich_text : [];
  const cells = block.type === 'table_row' && Array.isArray(content.cells) ? content.cells.flat() : [];
  return [...rich, ...cells].map(item => item.plain_text || item.text?.content || '').join('');
}
async function notionBodyCount(token, pageId) {
  let count = 0, visited = 0;
  async function scan(parentId, depth) {
    if (depth > 8) throw Error('본문 중첩 한도를 초과했습니다.');
    let cursor;
    do {
      const endpoint = new URL(`https://api.notion.com/v1/blocks/${parentId}/children`);
      endpoint.searchParams.set('page_size', '100');
      if (cursor) endpoint.searchParams.set('start_cursor', cursor);
      const response = await notionRequest(token, endpoint.toString());
      if (!Array.isArray(response.results)) throw Error('Notion 본문 응답 형식이 예상과 다릅니다.');
      for (const block of response.results) {
        if (++visited > 1000) throw Error('본문 블록 조회 한도를 초과했습니다.');
        count += Array.from(blockText(block).replace(/\s/g, '')).length;
        if (block.has_children) await scan(block.id, depth + 1);
      }
      cursor = response.has_more ? response.next_cursor : null;
      if (response.has_more && !cursor) throw Error('Notion 본문 커서가 없습니다.');
    } while (cursor);
  }
  await scan(pageId, 0);
  return count;
}

async function backfillBodyScores(db, token, options = {}) {
  if (!token) throw Error('Notion 통합 토큰이 설정되지 않았습니다.');
  const notionState = (await db.collection('lessonLogSyncState').doc('notion').get()).data() || {};
  if (notionState.syncing) return { scanned: 0, fetched: 0, deferred: true };
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 90));
  const progressRef = db.collection('lessonLogBodyScoreState').doc('backfill');
  const progress = (await progressRef.get()).data() || {};
  let query = db.collection('lessonLogNotionPages').orderBy('classDate', 'desc').limit(pageSize);
  if (progress.cursorId) {
    const cursor = await db.collection('lessonLogNotionPages').doc(progress.cursorId).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }
  const snapshot = await query.get();
  if (snapshot.empty) {
    await progressRef.set({ cursorId: null, completedAt: new Date(), updatedAt: new Date() }, { merge: true });
    return { scanned: 0, fetched: 0, complete: true };
  }
  const docs = snapshot.docs;
  const cached = await db.getAll(...docs.map(doc => db.collection('lessonLogBodyScores').doc(doc.id)));
  const pending = docs.filter((doc, index) => {
    const score = cached[index].data();
    return !score || score.editedAt !== doc.data().editedAt || !Number.isInteger(score.charCount);
  });
  let fetched = 0, failed = 0, nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(2, pending.length) }, async () => {
    while (nextIndex < pending.length) {
      const doc = pending[nextIndex++];
      try {
        const charCount = await notionBodyCount(token, doc.id);
        await db.collection('lessonLogBodyScores').doc(doc.id).set({ editedAt: doc.data().editedAt || '', charCount, checkedAt: new Date() });
        fetched++;
      } catch (error) {
        failed++;
        console.error('Notion body backfill failed', { pageId: doc.id, message: String(error.message || error).slice(0, 160) });
      }
      if (pending.length > 2) await new Promise(resolve => setTimeout(resolve, 700));
    }
  }));
  const complete = docs.length < pageSize;
  await progressRef.set({ cursorId: complete ? null : docs[docs.length - 1].id, scanned: Number(progress.scanned || 0) + docs.length, fetched: Number(progress.fetched || 0) + fetched, failed: Number(progress.failed || 0) + failed, ...(complete ? { completedAt: new Date() } : {}), updatedAt: new Date() }, { merge: true });
  return { scanned: docs.length, fetched, failed, complete };
}

async function scoreBodies(db, who, input, token) {
  if (!token) fail('failed-precondition', 'Notion 연결이 필요합니다.');
  const ids = input.pageIds;
  if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(id))) fail('invalid-argument', '본문 점수 요청을 확인해 주세요.');
  if (!ids.length) return { results: [] };
  const allowed = new Set((await list(db, who, input)).rows.map(row => row.notionId).filter(Boolean));
  const unique = [...new Set(ids)];
  if (unique.some(id => !allowed.has(id))) fail('permission-denied', '조회할 수 없는 일지가 포함되어 있습니다.');
  const pageRefs = unique.map(id => db.collection('lessonLogNotionPages').doc(id));
  const cacheRefs = unique.map(id => db.collection('lessonLogBodyScores').doc(id));
  const [pages, caches] = await Promise.all([db.getAll(...pageRefs), db.getAll(...cacheRefs)]);
  const results = [];
  for (let index = 0; index < unique.length; index++) {
    const page = pages[index].data(), cached = caches[index].data();
    if (!page) { results.push({ pageId: unique[index], status: 'unavailable' }); continue; }
    if (cached && cached.editedAt === page.editedAt && Number.isInteger(cached.charCount)) {
      results.push({ pageId: unique[index], status: 'ok', charCount: cached.charCount, score: bodyScore(cached.charCount) });
      continue;
    }
    try {
      const charCount = await notionBodyCount(token, unique[index]);
      await cacheRefs[index].set({ editedAt: page.editedAt || '', charCount, checkedAt: new Date() });
      results.push({ pageId: unique[index], status: 'ok', charCount, score: bodyScore(charCount) });
    } catch (error) {
      console.error('Notion body score failed', { pageId: unique[index], message: String(error.message || error).slice(0, 160) });
      results.push({ pageId: unique[index], status: 'unavailable' });
    }
  }
  return { results };
}

async function notionDataSourceId(token) {
  const database = await notionRequest(token, `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}`);
  const sources = database.data_sources || [];
  if (NOTION_DATA_SOURCE_ID) {
    if (!sources.some(source => source.id === NOTION_DATA_SOURCE_ID)) throw Error('설정된 Notion 데이터 소스 ID가 수업일지 DB에 없습니다.');
    return NOTION_DATA_SOURCE_ID;
  }
  if (sources.length !== 1) throw Error('Notion 수업일지 DB의 데이터 소스가 하나가 아닙니다. NOTION_LESSON_LOG_DATA_SOURCE_ID를 지정해 주세요.');
  return sources[0].id;
}

async function fetchNotionPages(token) {
  if (!token || !/^\w[\w-]*$/.test(token)) throw Error('Notion 통합 토큰이 설정되지 않았습니다.');
  const dataSourceId = await notionDataSourceId(token);
  const pages = [];
  let cursor;
  do {
    const response = await notionRequest(token, `https://api.notion.com/v1/data_sources/${dataSourceId}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    if (!Array.isArray(response.results)) throw Error('Notion 응답 형식이 예상과 다릅니다.');
    for (const raw of response.results) {
      const page = normalizeNotionPage(raw);
      if (!page) continue;
      for (const [name, field] of [['학생명', 'studentRelationIds'], ['강사명', 'teacherRelationIds']]) {
        const relation = raw.properties?.[name];
        if (!relation?.has_more) continue;
        const ids = []; let relationCursor = '';
        do {
          const endpoint = new URL(`https://api.notion.com/v1/pages/${raw.id}/properties/${encodeURIComponent(relation.id)}`);
          endpoint.searchParams.set('page_size', '100');
          if (relationCursor) endpoint.searchParams.set('start_cursor', relationCursor);
          const related = await notionRequest(token, endpoint.toString());
          ids.push(...(related.results || []).map(item => item.relation?.id).filter(Boolean));
          const next = related.has_more ? related.next_cursor : '';
          if (related.has_more && (!next || next === relationCursor) || ids.length > 1000) throw Error('Notion 관계형 조회 한도 초과');
          relationCursor = next;
        } while (relationCursor);
        page[field] = ids;
      }
      page.calendarKeys = page.studentRelationIds.map(id => id.replace(/-/g, '').toLowerCase() + '|' + page.classDate.slice(0, 7));
      pages.push(page);
    }
    if (pages.length > MAX_MIRROR_PAGES) throw Error('Notion 기록이 동기화 한도를 초과했습니다.');
    cursor = response.has_more ? response.next_cursor : null;
    if (response.has_more && !cursor) throw Error('Notion 페이지 커서가 없습니다.');
  } while (cursor);
  const relatedIds = [...new Set(pages.flatMap(page => [...(page.studentRelationIds || []), ...(page.teacherRelationIds || [])]))];
  const relatedNames = new Map();
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(2, relatedIds.length) }, async () => {
    while (nextIndex < relatedIds.length) {
      const id = relatedIds[nextIndex++];
      const related = await notionRequest(token, `https://api.notion.com/v1/pages/${id}`);
      const title = Object.values(related.properties || {}).find(value => value.type === 'title')?.title || [];
      relatedNames.set(id, title.map(item => item.plain_text || '').join('').trim());
      await new Promise(resolve => setTimeout(resolve, 700));
    }
  }));
  for (const page of pages) {
    page.studentNames = (page.studentRelationIds || []).map(id => relatedNames.get(id) || '').filter(Boolean);
    page.teacherNames = (page.teacherRelationIds || []).map(id => relatedNames.get(id) || '').filter(Boolean);
    if (page.studentNames.length === 1) page.studentName = page.studentNames[0];
    if (page.teacherNames.length === 1) page.teacherName = page.teacherNames[0];
    // Preserve stable relation IDs for the intranet student calendar.
  }
  const complete = pages.filter(page => page.classDate && (page.studentId || page.studentName || page.studentNames.length) && (page.teacherUid || page.teacherName || page.teacherNames.length));
  return { pages: complete, incompleteCount: pages.length - complete.length };
}

async function sync(db, token) {
  const stateRef = db.collection('lessonLogSyncState').doc('notion');
  const leaseId = randomUUID();
  const claimed = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);
    const previous = snapshot.data() || {};
    const startedAt = previous.syncStartedAt?.toDate?.();
    if (previous.syncing && startedAt && Date.now() - startedAt.getTime() < 12 * 60 * 1000) return false;
    transaction.set(stateRef, { syncing: true, syncPhase: 'fetching', syncStartedAt: new Date(), syncLeaseId: leaseId, lastAttemptAt: new Date() }, { merge: true });
    return true;
  });
  if (!claimed) return { inProgress: true };
  try {
    const { pages, incompleteCount } = await fetchNotionPages(token);
    await stateRef.set({ syncPhase: 'writing' }, { merge: true });
    const existing = await db.collection('lessonLogNotionPages').get();
    const incoming = new Map(pages.map(page => [page.id, page]));
    const previousPages = new Map(existing.docs.map(doc => [doc.id, doc.data()]));
    const writes = [
      ...pages.filter(page => !isDeepStrictEqual(previousPages.get(page.id), page)).map(page => ({ type: 'set', id: page.id, data: page })),
      ...existing.docs.filter(doc => !incoming.has(doc.id)).map(doc => ({ type: 'delete', id: doc.id })),
    ];
    for (let offset = 0; offset < writes.length; offset += 300) {
      const batch = db.batch();
      for (const item of writes.slice(offset, offset + 300)) {
        const ref = db.collection('lessonLogNotionPages').doc(item.id);
        if (item.type === 'delete') batch.delete(ref);
        else batch.set(ref, item.data);
      }
      await batch.commit();
    }
    await stateRef.set({ lastSuccessAt: new Date(), syncing: false, syncPhase: null, syncLeaseId: null, error: null, pageCount: pages.length, incompleteCount, calendarSchemaVersion: 1, databaseId: NOTION_DATABASE_ID });
    return { pageCount: pages.length, incompleteCount };
  } catch (error) {
    await stateRef.set({ syncing: false, syncPhase: null, syncLeaseId: null, error: String(error.message || error).slice(0, 300), lastAttemptAt: new Date() }, { merge: true });
    throw error;
  }
}

async function handle(db, uid, input, token) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-argument', '요청 형식을 확인해 주세요.');
  const who = await actor(db, uid);
  if (input.action === 'consultationReminderCandidates') return require('./consultation-reminders').load(db,who,sourceLessons,teacherAccounts,teacherDecisions,actor);
  if (input.action === 'list') return list(db, who, input);
  if (['currentStudentSubjects', 'studentRecentLessons'].includes(input.action)) return jikboLessons(db, who, input);
  if (input.action === 'studentCourses') return studentCourses(db, who, input);
  if (input.action === 'scoreBodies') return scoreBodies(db, who, input, token);
  if (input.action === 'resolveTeacher') return resolveTeacher(db, who, input);
  if (input.action === 'sync') {
    if (!who.staff) fail('permission-denied', '동기화는 실무자만 실행할 수 있습니다.');
    try { return await sync(db, token); }
    catch (error) { fail('failed-precondition', String(error.message || error).slice(0, 300)); }
  }
  fail('invalid-argument', '지원하지 않는 요청입니다.');
}

module.exports = { handle, actor, sourceLessons, fetchNotionPages, sync, backfillBodyScores, bodyScore, blockText, notionBodyCount };
