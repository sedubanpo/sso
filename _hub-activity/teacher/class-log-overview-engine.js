// Generated from ../class-log-overview-direct.js; verified by hub-notifications.test.js.
(function exposeClassLogOverviewEngine(global) {
  'use strict';

  function text(value) { return String(value == null ? '' : value).trim(); }
  function teacherName(value) {
    return text(value).replace(/\s*T$/i, '').replace(/선생님|teacher|강사|TR/gi, '').replace(/\s+/g, '');
  }
  function studentName(value) {
    let valueText = text(value).replace(/^\/+|\/+$/g, '').replace(/^1:1\s*/, '');
    if (valueText.indexOf('/') > -1) valueText = valueText.split('/')[0];
    return valueText.replace(/\s+/g, '');
  }
  function compactTime(value) {
    let valueText = text(value).replace(/\s+/g, '');
    if (!valueText) return '';
    const match = valueText.match(/^(오전|오후|AM|PM)?(\d{1,2}):(\d{2})(?::\d{2})?(AM|PM)?$/i);
    if (!match) return valueText.replace(/(:\d{2})(:\d{2})$/, '$1');
    let prefix = String(match[1] || match[4] || '');
    let hour = Number(match[2]);
    let label = /PM/i.test(prefix) || prefix === '오후' ? '오후' : (/AM/i.test(prefix) || prefix === '오전' ? '오전' : '');
    if (!label) {
      if (hour === 0) { label = '오전'; hour = 12; }
      else if (hour < 12) label = '오전';
      else if (hour === 12) label = '오후';
      else { label = '오후'; hour -= 12; }
    } else {
      if (label === '오전' && hour === 0) hour = 12;
      if (label === '오전' && hour > 12) hour -= 12;
      if (label === '오후' && hour > 12) hour -= 12;
    }
    return `${label} ${hour}:${match[3]}`;
  }
  function timeRange(start, end) {
    const startText = compactTime(start), endText = compactTime(end);
    return startText && endText ? `${startText}~${endText}` : (startText || endText);
  }
  function lessonKey(student, start, end, className) {
    return [studentName(student), compactTime(start), compactTime(end), text(className).replace(/\s+/g, '')].join('|');
  }
  function isReviewTarget(row) {
    const category = text(row.category), teacher = text(row.teacher_name), student = text(row.student_name);
    const status = text(row.status), start = text(row.start_time_text), end = text(row.end_time_text);
    if (!category && !teacher && !student && !start && !end) return false;
    return !(!category && !teacher && !start && !end && /^\d+(\.\d+)?$/.test(status));
  }
  function isCountable(lesson) {
    const status = text(lesson && lesson.status);
    return status !== '당일취소' && status.indexOf('예고') === -1 && Number(lesson && lesson.hours || 0) > 0;
  }
  function batchDates(batch) {
    const metadata = batch && batch.metadata || {}, dates = {};
    (metadata.sourceDates || []).forEach(function(value) { if (/^\d{4}-\d{2}-\d{2}$/.test(text(value))) dates[text(value)] = true; });
    [metadata.minDate, metadata.maxDate].forEach(function(value) { if (/^\d{4}-\d{2}-\d{2}$/.test(text(value))) dates[text(value)] = true; });
    const summary = metadata.uploadSummary || {}, reconcile = metadata.reconcile || {};
    [summary.addedByDate, summary.changedByDate, reconcile.staleByDate].forEach(function(map) {
      Object.keys(map || {}).forEach(function(value) { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) dates[value] = true; });
    });
    (summary.addedSamples || []).concat(summary.changedSamples || [], reconcile.staleSamples || []).forEach(function(sample) {
      const value = text(sample && (sample.date || sample.class_date)); if (/^\d{4}-\d{2}-\d{2}$/.test(value)) dates[value] = true;
    });
    return Object.keys(dates).sort();
  }
  function expectedBatchRows(batch, date) {
    const metadata = batch && batch.metadata || {}, snapshot = Array.isArray(metadata.accessRowsSnapshot) ? metadata.accessRowsSnapshot : [];
    if (snapshot.length) return snapshot.filter(function(row) { return text(row && (row.date || row.class_date)) === date; }).length;
    const dates = batchDates(batch);
    if (dates.length === 1 && dates[0] === date) return Number(batch && batch.row_count || 0);
    const summary = metadata.uploadSummary || {};
    return Number((summary.addedByDate || {})[date] || 0) + Number((summary.changedByDate || {})[date] || 0);
  }
  function filterAttendanceRows(rows, batches, year, month) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`, latest = {};
    const intranetDates = new Set((rows || []).filter(function(row) { return row.sourceSystem === 'intranet'; }).map(function(row) { return text(row.class_date); }));
    (batches || []).filter(function(batch) {
      return text(batch && batch.source) === 'access-daily' && text(batch && batch.status) === 'completed';
    }).sort(function(a, b) { return text(b.imported_at).localeCompare(text(a.imported_at)); }).forEach(function(batch) {
      batchDates(batch).forEach(function(date) { if (date.indexOf(`${monthKey}-`) === 0 && !latest[date] && !intranetDates.has(date)) latest[date] = batch; });
    });
    const counts = {};
    (rows || []).forEach(function(row) {
      const date = text(row.class_date), batchId = text(row.import_batch_id);
      if (date && batchId) { counts[date] = counts[date] || {}; counts[date][batchId] = Number(counts[date][batchId] || 0) + 1; }
    });
    const incompleteDates = [];
    Object.keys(latest).forEach(function(date) {
      const batch = latest[date], batchId = text(batch.id), found = Number((counts[date] || {})[batchId] || 0), expected = expectedBatchRows(batch, date);
      if (!found || (expected > 0 && found < expected)) incompleteDates.push(date);
    });
    const filtered = (rows || []).filter(function(row) {
      const date = text(row.class_date), batch = latest[date];
      if (!batch || incompleteDates.indexOf(date) > -1) return true;
      return text(row.import_batch_id) === text(batch.id);
    });
    return { rows: filtered, incompleteDates };
  }
  function emptyLog() {
    return { total: 0, submitted: 0, missing: 0, reasons: {}, entries: [], entryKeys: {}, sourceCounts: {} };
  }
  function addLog(logMap, row) {
    const date = text(row.class_date), teacher = teacherName(row.teacher_name), student = text(row.student_name);
    const status = text(row.status), reason = text(row.reason), start = compactTime(row.start_time_text);
    const end = compactTime(row.end_time_text), className = text(row.class_name), source = 'portal';
    if (!date || !teacher || !student || !status) return;
    const groupKey = `${date}|${teacher}`;
    const log = logMap[groupKey] || (logMap[groupKey] = emptyLog());
    const key = lessonKey(student, start, end, className);
    if (log.entryKeys[key]) {
      const index = log.entryKeys[key] - 1;
      const previous = log.entries[index] || {};
      if (text(previous.status) !== status) {
        if (text(previous.status) === '미제출') log.missing = Math.max(0, log.missing - 1);
        else log.submitted = Math.max(0, log.submitted - 1);
        if (status === '미제출') log.missing += 1; else log.submitted += 1;
      }
      log.entries[index] = { student, status, reason, start, end, className, source: previous.source || source };
      if (status === '미제출' && reason) log.reasons[reason] = true;
      return;
    }
    log.entryKeys[key] = log.entries.length + 1;
    log.total += 1;
    log.sourceCounts[source] = Number(log.sourceCounts[source] || 0) + 1;
    log.entries.push({ student, status, reason, start, end, className, source });
    if (status === '미제출') { log.missing += 1; if (reason) log.reasons[reason] = true; }
    else log.submitted += 1;
  }
  function subset(log) {
    const result = emptyLog();
    (log.entries || []).forEach(function(entry) {
      const source = text(entry.source) || 'legacy';
      result.entries.push(entry); result.total += 1;
      result.sourceCounts[source] = Number(result.sourceCounts[source] || 0) + 1;
      if (text(entry.status) === '미제출') { result.missing += 1; if (entry.reason) result.reasons[entry.reason] = true; }
      else result.submitted += 1;
    });
    return result;
  }
  function effective(taught, log) {
    const lessons = (taught.lessons || []).filter(isCountable), entries = log.entries || [];
    if (!lessons.length) return { submitted: Number(log.submitted || 0), missing: Number(log.missing || 0) };
    const exact = {}, legacyByStudent = {};
    entries.forEach(function(entry) {
      const student = studentName(entry.student);
      if (!student) return;
      if (entry.start || entry.end || entry.className) exact[lessonKey(entry.student, entry.start, entry.end, entry.className)] = entry;
      else if (!legacyByStudent[student]) legacyByStudent[student] = entry;
    });
    let submitted = 0, missing = 0, matched = 0;
    lessons.forEach(function(lesson) {
      const hit = exact[lessonKey(lesson.student, lesson.start, lesson.end, lesson.className)] || legacyByStudent[studentName(lesson.student)];
      if (!hit) missing += 1;
      else if (text(hit.status) === '미제출') { matched += 1; missing += 1; }
      else { matched += 1; submitted += 1; }
    });
    return matched === 0 && entries.length
      ? { submitted: Math.min(Number(log.submitted || 0), lessons.length), missing: Number(log.missing || 0) }
      : { submitted, missing };
  }
  function statusLabel(hasClass, log, stats) {
    if (hasClass) {
      if (!Number(log.total || 0)) return '기록없음';
      if (stats.missing > 0 && stats.submitted > 0) return '부분 미제출';
      if (stats.missing > 0) return '미제출';
      return '제출 완료';
    }
    return Number(log.total || 0) > 0 ? '기록만 존재' : '기록 없음';
  }
  function compactOverview(result) {
    const dayMap = {};
    Object.keys(result.dayMap).forEach(function(date) {
      const day = result.dayMap[date];
      dayMap[date] = Object.assign({}, day, {
        teachers: day.teachers.map(function(row) {
          const compact = Object.assign({}, row);
          delete compact.logEntries; delete compact.taughtLessons;
          return compact;
        })
      });
    });
    return {
      success: true, year: result.year, month: result.month, daysInMonth: result.daysInMonth,
      classLogStorage: result.classLogStorage, compact: true, detailStripped: true,
      generatedAt: new Date().toISOString(), directFallbackRequired: result.directFallbackRequired,
      incompleteAttendanceDates: result.incompleteAttendanceDates, dayMap
    };
  }
  function build(attendanceRows, classLogRows, signatureRows, year, month, options) {
    const y = Number(year), m = Number(month), compact = options && options.compact === true;
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) throw new Error('조회 월 정보가 올바르지 않습니다.');
    const attendance = filterAttendanceRows(attendanceRows || [], options && options.batches || [], y, m);
    const taughtMap = {}, logMap = {}, signatureMap = {};
    attendance.rows.forEach(function(row) {
      if (!isReviewTarget(row)) return;
      const date = text(row.class_date), teacher = teacherName(row.teacher_name), student = text(row.student_name);
      if (!date || !teacher) return;
      const groupKey = `${date}|${teacher}`, status = text(row.status);
      let hours = Number(row.hours || 0);
      const taught = taughtMap[groupKey] || (taughtMap[groupKey] = { count: 0, hours: 0, students: {}, lessons: [] });
      if (status !== '당일취소' && status.indexOf('예고') === -1 && hours > 0) { taught.count += 1; taught.hours += hours; }
      if (student) taught.students[student] = true;
      taught.lessons.push({ student, status, className: text(row.category), start: text(row.start_time_text), end: text(row.end_time_text), time: timeRange(row.start_time_text, row.end_time_text), hours: Math.round(Math.max(0, hours) * 10) / 10 });
    });
    (classLogRows || []).forEach(function(row) { addLog(logMap, row); });
    (signatureRows || []).forEach(function(row) {
      const date = text(row.class_date), teacher = teacherName(row.teacher_name);
      if (date && teacher) signatureMap[`${date}|${teacher}`] = { signed: row.signed === true || text(row.signed).toLowerCase() === 'true', signedAt: row.signed_at || '', signedBy: row.signed_by || '' };
    });
    const daysInMonth = new Date(y, m, 0).getDate(), dayMap = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const names = {};
      [taughtMap, logMap, signatureMap].forEach(function(map) { Object.keys(map).forEach(function(key) { if (key.indexOf(`${date}|`) === 0) names[key.slice(date.length + 1)] = true; }); });
      const rows = [], submittedTeachers = [], missingTeachers = [], partialTeachers = [], noLogTeachers = [], agreementTeachers = [], agreementRecordTeachers = [];
      Object.keys(names).sort(function(a, b) { return a.localeCompare(b, 'ko'); }).forEach(function(teacher) {
        const key = `${date}|${teacher}`, taught = taughtMap[key] || { count: 0, hours: 0, students: {}, lessons: [] };
        const log = logMap[key] || emptyLog(), portalLog = subset(log), stats = effective(taught, log), portalStats = effective(taught, portalLog);
        const hasClass = taught.count > 0, status = statusLabel(hasClass, log, stats), portalStatus = statusLabel(hasClass, portalLog, portalStats), signature = signatureMap[key];
        if (!hasClass && log.total === 0) return;
        const agreementSigned = !!(signature && signature.signed) || Number(log.sourceCounts.portal || 0) > 0;
        if (agreementSigned) { agreementRecordTeachers.push(teacher); if (hasClass) agreementTeachers.push(teacher); }
        if (hasClass && status === '제출 완료') submittedTeachers.push(teacher);
        if (hasClass && status === '미제출') missingTeachers.push(teacher);
        if (hasClass && status === '부분 미제출') partialTeachers.push(teacher);
        if (hasClass && status === '기록없음') noLogTeachers.push(teacher);
        rows.push({
          teacher, hasClass, taughtCount: taught.count, taughtHours: Math.round(taught.hours * 10) / 10,
          logCount: log.total, submittedCount: stats.submitted, missingCount: stats.missing,
          reasons: Object.keys(log.reasons), sourceCounts: log.sourceCounts,
          portalLogCount: portalLog.total, portalSubmittedCount: portalStats.submitted, portalMissingCount: portalStats.missing, portalStatus,
          notionLogCount: 0, notionSubmittedCount: 0, notionMissingCount: hasClass ? stats.missing : 0, notionStatus: hasClass ? '기록없음' : '기록 없음',
          hoursAgreementSigned: agreementSigned, hoursAgreementSource: signature && signature.signed ? 'signature' : (agreementSigned ? 'legacy-class-log' : ''),
          hoursAgreementSignedAt: signature ? text(signature.signedAt) : '', hoursAgreementSignedBy: signature ? text(signature.signedBy) : '',
          logEntries: log.entries, taughtLessons: taught.lessons, taughtStudents: Object.keys(taught.students), status
        });
      });
      dayMap[date] = {
        dateKey: date, day, teachers: rows,
        taughtTeacherCount: submittedTeachers.length + missingTeachers.length + partialTeachers.length + noLogTeachers.length,
        submittedTeacherCount: submittedTeachers.length, missingTeacherCount: missingTeachers.length,
        partialTeacherCount: partialTeachers.length, noLogTeacherCount: noLogTeachers.length,
        agreementTeacherCount: agreementTeachers.length, agreementRecordTeacherCount: agreementRecordTeachers.length,
        missingTeachers, partialTeachers, noLogTeachers, agreementTeachers, agreementRecordTeachers
      };
    }
    const result = { success: true, year: y, month: m, daysInMonth, classLogStorage: { primary: 'supabase', supabaseLogCount: (classLogRows || []).length, legacyReadEnabled: false, sheetBackupDefaultEnabled: false }, directFallbackRequired: attendance.incompleteDates.length > 0, incompleteAttendanceDates: attendance.incompleteDates, dayMap };
    return compact ? compactOverview(result) : result;
  }

  global.PortalClassLogOverviewEngine = Object.freeze({ build, compactTime, teacherName, studentName, filterAttendanceRows, batchDates });
})(module.exports);
