# Whistle Contract Management

전국 지자체와 체결되는 주차단속 계약을 통합 관리하는 웹 시스템.

## 기술 스택

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Backend**: Supabase (Postgres 17 + Auth + Storage + RLS)
- **Hosting**: Vercel (예정)

## 데이터 모델 (요약)

`document/2.ERD_명세서_v1.0.docx` 참조.

- 운영 테이블 8종 — `users`, `local_governments`, `contracts`, `contract_files`, `contract_status_history`, `contract_extensions`, `activity_logs`, `export_jobs`
- ENUM 8종 — `user_role`, `lg_class`, `contract_status`, `transition_type`, `event_type`, `target_type`, `job_type`, `job_status`
- 모든 운영 테이블 RLS 활성화 + 이력 3종은 INSERT-ONLY 트리거 강제
- `contracts.version` 으로 낙관적 락 적용

지자체 시드: 행정구역 252건 (구 104 / 군 82 / 시 66) — `document/seed_local_governments.sql`

## 권한 (Role)

| Role | 권한 |
| --- | --- |
| **Master** | 전체 권한 + 사용자 관리 + 영구 삭제 |
| **Accounting** | 계약 등록·수정·갱신·연장·직전 보정 |
| **Viewer** | 조회 전용 (다운로드 불가) |

가입 시 기본 권한은 `viewer`. `pjy413@gmail.com` 은 auth.users 트리거가 자동 `master` 부여.

## 로컬 실행

```bash
cp .env.example .env.local
# .env.local 의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 채우기
npm install
npm run dev
```

## 구현 진행 상황

### Phase 0 — 인프라 (완료)
- [x] Supabase 스키마 (8 테이블 + 8 ENUM + RLS + 트리거 + 인덱스)
- [x] 행정구역 252건 시드
- [x] auth.users → public.users 자동 동기화 트리거 + master 부트스트랩
- [x] `contract-files` Storage 버킷 + RLS 정책
- [x] KPI 집계 헬퍼 함수, 만료 자동종료 함수

### Phase 1 — MVP (완료)
- [x] 로그인 / 회원가입 / 로그아웃
- [x] 대시보드 3 KPI (계약완료/체결중/갱신중) + 만료 임박 + 최근 활동
- [x] 계약 목록 (상태 필터 + 지자체명 검색)
- [x] 신규 계약 등록 (지자체 252건 검색 → 체결중 진입)
- [x] 계약 상세 (정보 + 파일 + 상태 이력 + 연장 이력)
- [x] PDF 업로드 → "계약완료로 변경하시겠습니까?" 확인 팝업
- [x] 권한별 버튼 노출 제어 (Master/Accounting/Viewer)
- [x] 낙관적 락 충돌 감지

### Phase 2 — 운영 기능 (완료)
- [x] 계약기간 연장 (Extend) — 모달 + 다회 연장 이력 + 낙관락
- [x] 상태 보정 (Correction) — RPC + GUC 기반 트리거 우회 + 권한 차등 (Master 전체 / Accounting 직전)
- [x] KPI Drill-down — 카드 클릭 → 필터 적용된 계약 목록
- [x] 활동 로그 뷰 — `/activity` (Master 전체 / Accounting 본인, RLS 적용)
- [x] 만료 임박 보드 — `/expiring` 7/30/60일 버킷 카운트
- [x] 갱신 착수 (renew_start) — 신규 계약 행 + parent_contract_id 자기참조
- [x] 종료 처리 UI — 사유 필수 모달

### Phase 3 — 부가 기능 (예정)
- [ ] ZIP 일괄 다운로드 (Edge Function)
- [ ] 엑셀 내보내기
- [ ] 사용자 관리 (Master)
- [ ] 만료 자동 종료 cron 등록

## 핵심 설계 포인트

1. **상태(status)는 contracts에 단일 보유** — 한 지자체 내 다수 계약 건의 독립 상태 관리
2. **갱신 시 신규 contracts 행 생성** + `parent_contract_id` 자기참조로 갱신 체인 추적
3. **모든 이력 테이블 INSERT-ONLY** — DB 트리거로 UPDATE/DELETE 거부
4. **`contracts.version` 낙관적 락** — 동시 수정 충돌 시 거부, 클라이언트는 새로고침 후 재시도
5. **`activity_logs.target_id` 다형 참조** — FK 미설정, `target_type` 으로 분기
6. **만료일 비교는 항상 `COALESCE(extended_expiry_date, expiry_date)`** — 연장 반영 실효 만료일 기준
