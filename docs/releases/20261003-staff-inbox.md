# 허브 강사 테스트 계정 및 실무자 알림 — 2026-10-03

- 지정 공용 관리자만 /teachers, /switch-teacher를 사용할 수 있다. Firebase UID/로그인 alias로 검증하고 이름 문자열은 인증에 사용하지 않는다. 전환 기록을 남긴 뒤 대상 강사 토큰을 발급한다. 강사 계정 버튼은 공용 계정을 선택했을 때 표시한다.
- S-LMS 새 hubPermissionApi(slms-roadmap)는 PENDING permissionRequests를 활성 S-LMS 실무자에게 제공한다. 승인/거절은 transaction에서 처리한다. 대상 강사/학생/계정 권한을 다시 검증하며 승인 시 정확한 1:1 studentPermissions와 관련 자동해제 정책만 갱신한다. 처리자와 감사 기록을 남긴다. 이미 처리된 결과는 멱등 처리하거나 충돌을 반환한다. 이전 UID가 연결되지 않은 요청은 S-LMS에서 확인하도록 안내한다.
- 강사 포털 teacherPortalNotifications는 실무자에게 portal_list_teacher_hours_issues의 received/held 상태를 반환한다. Firebase 계정과 원래 Supabase RPC의 관리자 권한을 모두 통과해야 한다. 시수 오류 처리 자체는 기존 강사 포털에서 진행한다. 정책/서비스 키 변경 없음.
- 허브 알림은 기존 5분 주기 및 수동 새로고침을 사용한다. 승인/거절 후 즉시 갱신한다. 실무자 전용 종류는 강사 UI에서도 제거한다.
- 자동 검증: 허브 48, S-LMS 요청·권한 22, 포털 3 테스트 통과. 문법 검사 39 통과.
- 격리 브라우저: 관리자 선택→강사 선택→강사 3개 메뉴 및 직원 알림 제외, 실무자 승인 버튼과 오류제보, 승인 후 목록 제거, 390px 모바일 확인. 운영 업무 요청/시수/권한 데이터는 테스트 중 변경하지 않았다.
- 운영 API 배포: hubSsoApi, hubPermissionApi, teacherPortalNotifications. 기존 허브 health 정상 및 비로그인 권한 API 차단 확인. 로그인한 실제 계정의 승인/시수 제보 수신은 별도 확인 필요.

Canonical S-LMS files: /Users/anjongseong/Documents/New project/s-lms/functions/hub-permissions.js and hub-permissions.test.js; export hubPermissionApi in functions/index.js. Only that new function is deployed. No ownership transfer of hubActivityApi.
