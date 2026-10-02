'use strict';

const DATE = /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const ACTIVE_KINDS = new Set(['regular', 'late', 'cancelMakeup', 'absenceMakeup', 'lateMakeup', 'free']);
const clean = value => String(value == null ? '' : value).trim();
const compact = value => clean(value).replace(/\s+/g, '').toLowerCase();
const compactTeacher = value => compact(value).replace(/t$/i, '').replace(/강사$/, '');

function validDate(value) {
  return DATE.test(value) && new Date(value).toISOString().slice(0, 10) === value;
}

function monthsBetween(start, end) {
  if (!validDate(start) || !validDate(end) || end < start) throw Error('조회 기간을 확인해 주세요.');
  const first = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
  const last = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7)) - 1;
  if (last - first > 2 || (Date.parse(end) - Date.parse(start)) / 86400000 > 92) throw Error('최대 3개월까지만 조회할 수 있습니다.');
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const date = new Date(Date.UTC(Math.floor((first + index) / 12), (first + index) % 12, 1));
    return date.toISOString().slice(0, 7);
  });
}

// This is the intranet's publishedView rule, not its editable /daily projection.
function publishedLessons(period = {}, history = []) {
  const deleted = new Set(period.publishedDeletedIds || []);
  const current = period.publishedLessons || (period.status === 'sent' ? period.lessons : []) || [];
  const rows = new Map([...history, ...current].map(lesson => [lesson.id, lesson]));
  return [...rows.values()].filter(lesson => !deleted.has(lesson.id) && !lesson.deletedAt);
}

function applySentChanges(lessons, events, studentId, deletedIds = []) {
  const rows = new Map(lessons.map(lesson => [lesson.id, lesson]));
  const sent = (events || []).filter(event => event.status === 'sent').sort((a, b) =>
    Number(a.revision || 0) - Number(b.revision || 0) || String(a.requestId || '').localeCompare(String(b.requestId || '')));
  for (const event of sent) for (const change of event.changes || []) {
    if (change.studentId !== studentId || !change.lessonId) continue;
    if (change.action === 'delete' || change.after?.deletedAt) rows.delete(change.lessonId);
    else if (change.action === 'edit' && change.after) rows.set(change.lessonId, change.after);
  }
  return [...rows.values()].filter(lesson => !deletedIds.includes(lesson.id) && !lesson.deletedAt);
}

function normalizeLesson(lesson, studentId, studentName, periodKey) {
  if (!lesson || !ACTIVE_KINDS.has(lesson.kind) || !Number.isSafeInteger(lesson.payMinutes) || lesson.payMinutes <= 0 || !validDate(lesson.date)) return null;
  const lessonId = clean(lesson.id);
  if (!lessonId) return null;
  const className = clean(lesson.className);
  return {
    id: `${periodKey}|${lessonId}`,
    lessonId,
    studentId,
    studentName: clean(studentName || lesson.studentName || studentId),
    teacherUid: clean(lesson.teacherUid),
    teacherName: clean(lesson.teacher),
    classDate: lesson.date,
    start: clean(lesson.start),
    end: clean(lesson.end),
    subject: className.split('-')[0] || '',
    className,
    minutes: lesson.payMinutes,
    kind: lesson.kind,
  };
}

function notionPropertyText(property) {
  if (!property || typeof property !== 'object') return '';
  const value = property[property.type];
  if (Array.isArray(value)) return value.map(item => item.plain_text || item.name || '').join(' ').trim();
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.name || value.start || value.id || '';
  return '';
}

function property(page, names) {
  const properties = page.properties || {};
  for (const name of names) if (properties[name]) return notionPropertyText(properties[name]);
  return '';
}

function relationIds(page, name) {
  const value = page.properties?.[name];
  return value?.type === 'relation' ? (value.relation || []).map(item => clean(item.id)).filter(Boolean) : [];
}

function normalizeNotionPage(page) {
  if (!page || page.object !== 'page' || page.archived || page.in_trash) return null;
  return {
    id: clean(page.id),
    url: /^https:\/\/[^\s]+$/.test(page.url || '') ? page.url : '',
    lessonId: property(page, ['인트라넷 수업 ID', '수업 ID', '수업ID', 'lessonId', 'Lesson ID']),
    studentId: property(page, ['학생 ID', '학생ID', 'studentId']),
    studentName: property(page, ['학생명(검색용)', '학생명', '학생 이름', '학생', 'Student']),
    studentRelationIds: relationIds(page, '학생명'),
    teacherUid: property(page, ['강사 UID', '강사 ID', 'teacherUid']),
    teacherName: property(page, ['강사명', '강사 이름', '강사', 'Teacher']),
    teacherRelationIds: relationIds(page, '강사명'),
    classDate: property(page, ['수업일', '수업 날짜', '날짜', 'Date']).slice(0, 10),
    title: property(page, ['수업 제목(클릭)', '수업 제목', '이름']),
    materials: property(page, ['수업자료']),
    calendarKeys: relationIds(page, '학생명').map(id => id.replace(/-/g, '').toLowerCase() + '|' + property(page, ['수업일', '수업 날짜', '날짜', 'Date']).slice(0, 7)),
    start: property(page, ['시작 시간', '시작', 'Start']),
    editedAt: clean(page.last_edited_time),
  };
}

function resolveTeacherAccounts(lessons, accounts, decisions = new Map()) {
  const byName = new Map();
  for (const account of accounts || []) {
    const key = compactTeacher(account.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(account);
  }
  return lessons.map(lesson => {
    if (lesson.teacherUid) return { ...lesson, teacherMatch: 'source' };
    const choices = byName.get(compactTeacher(lesson.teacherName)) || [];
    const selected = decisions.get(lesson.id);
    if (choices.length === 1) return { ...lesson, teacherUid: choices[0].uid, teacherMatch: 'name' };
    if (choices.length > 1) {
      if (selected && choices.some(account => account.uid === selected.teacherUid && compactTeacher(selected.teacherName) === compactTeacher(lesson.teacherName))) {
        return { ...lesson, teacherUid: selected.teacherUid, teacherMatch: 'reviewed' };
      }
      return { ...lesson, teacherMatch: 'ambiguous', teacherCandidates: choices.map(account => ({ uid: account.uid, name: account.name, department: account.department || '', accountHint: account.accountHint || '' })) };
    }
    return { ...lesson, teacherMatch: 'unlinked' };
  });
}

function studentMatches(page, lesson, required = false) {
  const names = page.studentNames || [];
  const name = compact(lesson.studentName);
  if (page.studentId && page.studentId !== lesson.studentId) return false;
  if (names.length) return !!name && names.filter(value => compact(value) === name).length === 1;
  if (page.studentName) return compact(page.studentName) === name;
  return page.studentId ? true : !required;
}

function teacherMatches(page, lesson, required = false) {
  const names = page.teacherNames || [];
  if (page.teacherUid && page.teacherUid !== lesson.teacherUid) return false;
  if (names.length) return names.length === 1 && compactTeacher(names[0]) === compactTeacher(lesson.teacherName);
  if (page.teacherName) return compactTeacher(page.teacherName) === compactTeacher(lesson.teacherName);
  return page.teacherUid ? true : !required;
}

function compareLessons(lessons, notionPages, connected) {
  const pages = (notionPages || []).filter(Boolean);
  const pagesById = new Map(pages.map(page => [page.id, page]));
  const used = new Map();
  const rows = lessons.map(lesson => {
    if (!connected) return { ...lesson, status: 'unknown', notionUrl: '', reason: 'Notion 동기화 전' };
    const nameOnly = !lesson.teacherUid;
    if (lesson.teacherMatch === 'ambiguous') return { ...lesson, status: 'review', notionUrl: '', reason: '동명이인 강사 계정 검토 필요' };
    let candidates = pages.filter(page => page.lessonId && page.lessonId === lesson.lessonId && (!page.studentId || page.studentId === lesson.studentId));
    if (!candidates.length) candidates = pages.filter(page =>
      !page.lessonId && page.classDate === lesson.classDate &&
      studentMatches(page, lesson, true) && teacherMatches(page, lesson, true) &&
      (!page.start || page.start === lesson.start));
    if (!candidates.length) return { ...lesson, status: 'missing', notionUrl: '', reason: nameOnly ? '강사 계정 미연결 · 이름으로 대조' : '' };
    const multipleCandidates = candidates.length > 1;
    if (multipleCandidates) {
      const allIdentified = candidates.every(page =>
        page.classDate === lesson.classDate &&
        studentMatches(page, lesson, true) && teacherMatches(page, lesson, true) &&
        (!page.start || page.start === lesson.start));
      if (!allIdentified) return { ...lesson, status: 'review', notionUrl: '', reason: '일지 정보 불일치' };
    }
    const page = multipleCandidates ? candidates.slice().sort((a, b) => clean(b.editedAt).localeCompare(clean(a.editedAt)) || a.id.localeCompare(b.id))[0] : candidates[0];
    const conflicting = page.classDate && page.classDate !== lesson.classDate ||
      !studentMatches(page, lesson) || !teacherMatches(page, lesson);
    used.set(page.id, (used.get(page.id) || 0) + 1);
    return { ...lesson, status: conflicting ? 'review' : 'matched', notionUrl: page.url, reason: conflicting ? '일지 정보 불일치' : (page.studentNames || []).length > 1 ? '여러 학생 공동 일지' : multipleCandidates ? '같은 학생·강사·날짜의 일지 여러 건 확인' : nameOnly ? '강사 계정 미연결 · 이름/날짜로 확인' : '', notionId: page.id };
  });
  const shared = new Map();
  for (const row of rows) if (row.notionId) {
    if (!shared.has(row.notionId)) shared.set(row.notionId, []);
    shared.get(row.notionId).push(row);
  }
  return rows.map(row => {
    if (!row.notionId || used.get(row.notionId) <= 1) return row;
    const group = shared.get(row.notionId);
    const page = pagesById.get(row.notionId);
    const sameTeacherDate = group.every(item =>
      item.status === 'matched' &&
      item.classDate === row.classDate &&
      (item.teacherUid && row.teacherUid ? item.teacherUid === row.teacherUid : compactTeacher(item.teacherName) === compactTeacher(row.teacherName)));
    const distinctStudents = new Set(group.map(item => item.studentId));
    const listedStudents = page && group.every(item => studentMatches(page, item, true));
    return sameTeacherDate && (distinctStudents.size === 1 || listedStudents)
      ? { ...row, reason: distinctStudents.size > 1 ? '여러 학생 공동 일지' : '같은 학생·강사·날짜의 공동 일지' }
      : { ...row, status: 'review', reason: '서로 다른 학생·강사가 한 일지에 연결됨' };
  });
}

module.exports = { validDate, monthsBetween, publishedLessons, applySentChanges, normalizeLesson, normalizeNotionPage, resolveTeacherAccounts, compareLessons };
