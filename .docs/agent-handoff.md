# Handoff memo — tiếp tục triển khai app Nhắc bảo dưỡng xe máy

*Dán toàn bộ nội dung file này làm prompt cho 1 phiên Claude Code mới nếu phiên hiện tại bị ngắt giữa chừng. Cập nhật lại phần "Trạng thái tại thời điểm bàn giao" nếu bạn biết thêm gì đã đổi.*

## Bối cảnh

Đang triển khai app "Nhắc bảo dưỡng xe máy" (local-first PWA) tại `/home/emily/workspace/vehicle`:
- `client/` — frontend Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui (Radix, preset Nova) + Zustand + Dexie.js + MSW.
- `.docs/decision.md` — quyết định nghiệp vụ gốc (đọc trước, đây là nguồn sự thật nghiệp vụ).
- `.docs/implementation-plan-section-5.md` — kế hoạch kỹ thuật chi tiết (schema, user flow, API contract requirements D1-D8).
- `.docs/sync-api-contract.md` — **ĐÃ VIẾT XONG**, hợp đồng API đầy đủ (auth session-cookie+Redis+Google OAuth+CSRF, push/pull changefeed). Đây là nguồn sự thật cho `client/src/api/contract.types.ts`.
- `.docs/design-decoded-reference.html` — markup ĐÃ GIẢI MÃ từ prototype gốc `.docs/design.html` (file gốc là 1 "bundled artifact" tự giải nén bằng JS, quá lớn để đọc trực tiếp — bản decoded này mới là thứ hữu ích, đọc thẳng file này). Các block quan trọng theo dòng: sidebar/nav (221-249), Home (259-320), History (322-339), Costs (341-373), You/Settings (375-407), Log entry (409-455), Scan (457-485, **BỎ QUA — không nằm trong scope**), Upgrade (487-511, **BỎ QUA — không nằm trong scope**), sheets/toast (513-559), CSS/màu/font (141-219), logic JS tham khảo tên field (563-889).
- `/home/emily/.claude/plans/c-t-i-li-u-mellow-rossum.md` — **PLAN ĐÃ DUYỆT**, đọc đầy đủ trước khi làm gì tiếp. Chứa toàn bộ quyết định kiến trúc, schema, danh sách sửa lệch prototype/decision.md, milestone M0-M8.

## Quyết định quan trọng đã chốt (không hỏi lại user)

- Scope UI: chỉ đúng MVP theo decision.md — **KHÔNG** làm Scan (OCR odometer) và Upgrade/Plus (paywall) dù có trong prototype.
- Auth: email+password hoặc Google OAuth, session cookie `httpOnly`+`Secure`+Redis (backend CHƯA xây), CSRF double-submit cookie. Lần này chỉ làm UI + MSW mock, KHÔNG build backend thật.
- Local DB: Dexie.js. Ngôn ngữ: TypeScript.
- Sửa lệch so với prototype gốc (bắt buộc áp dụng khi build UI, xem đầy đủ trong plan):
  - Bỏ card "Fuel efficiency" ở Costs (decision.md loại khỏi scope) — chỉ giữ "Cost/km".
  - Bỏ nút Download ở History.
  - "Warn me ahead by" ở Settings hiển thị READ-ONLY (ngưỡng due_soon = 10%, hằng số hệ thống `DUE_SOON_REMAINING_RATIO`, KHÔNG phải setting user chỉnh).
  - Bỏ hẳn "Upgrade/Plus" khỏi Garage/toàn app.
  - Log entry: sửa UX "Type" 4-tile sai của prototype thành 2 bước — chọn **Fuel vs Service** trước, nếu Service mới chọn 1 trong các PartType `active=true` đọc từ Dexie (KHÔNG hard-code số lượng). Bỏ nút "Scan" ở mọi nơi.
  - Toggle "Reset the {part} reminder" chỉ hiện khi Service; Fuel đổi thành "Log as a full tank" (giữ field `isFullTank` cho tương lai, KHÔNG tính fuel efficiency).

## Trạng thái tại thời điểm bàn giao (kiểm tra lại — có thể đã có thêm tiến triển)

**Đã xong và verify bằng `npm run build` + `npm run test` (cả 2 đều PASS, 47 test xanh):**
- `client/src/domain/*` — pure business logic: `types.ts`, `constants.ts`, `reminder.ts` (+test), `odometer.ts` (+test), `validation.ts` (+test), `partType.ts`, `datetime.ts`. Đây là "sách luật" — ĐỌC KỸ trước khi viết UI dùng các hàm này, đừng tự tính lại reminder status ở nơi khác.
- `client/src/data/*` — Dexie schema (`db.ts`), seed PartType cố định (`seed.ts`), mapper domain↔wire (`mappers.ts`), outbox (`outbox.ts`), `repositories/*` (Vehicle/Reminder/Odometer/Fuel/Service — MỌI hàm ghi tự động enqueue outbox trong CÙNG transaction), `queries/*` (vehicleQueries, reminderQueries — kết hợp domain/reminder.ts, historyQueries, costQueries). Có test tích hợp qua `fake-indexeddb` (xem `vitest.setup.ts`, `data/testUtils.ts`).
- `client/src/hooks/*` — `useVehicles`, `useVehicle`, `useReminderStatuses`, `useCurrentOdometer`, `useHistoryEntries`, `useMonthlyCosts`, `useCostPerKm`, `useOnlineStatus`, `useOutboxPendingCount` — TẤT CẢ dùng `dexie-react-hooks`' `useLiveQuery`, đọc thẳng Dexie (Dexie là nguồn sự thật duy nhất, KHÔNG copy data sang Zustand).
- `client/src/api/*` — `contract.types.ts` (mirror `.docs/sync-api-contract.md`, wire format snake_case), `client.ts` (fetch thật, `credentials:'include'`, tự đính CSRF header cho method ghi), `errors.ts`, `config.ts` (`ENABLE_MSW` mặc định BẬT ở mọi dev build, không cần file `.env` — xem comment trong file, việc ghi `.env*` bị chặn bởi permission của harness này), `devGoogleMock.ts` (dev-only stand-in Google OAuth).
- `client/src/mocks/*` — MSW mock server đầy đủ cho AUTH (signup/login/logout/session/verify-email/forgot-reset-password/google-mock) VÀ SYNC (push/pull) — xem `db.ts` (state server giả, có LWW/dedupe/changefeed), `handlers/*`, `seedData.ts` (account demo: `demo@vehicle.app` / `demo12345`).
- `client/src/stores/*` — `useSessionStore` (status loading/authenticated/anonymous, KHÔNG chứa token vì session là httpOnly cookie), `useSyncStore` (status/lastSyncedAt/lastError — pendingCount đọc riêng qua hook, không nằm trong store này), `useUiStore` (chỉ `vehicleSwitcherOpen`, tối giản).
- `client/src/routes/*` + `client/src/App.tsx` + `client/src/main.tsx` — route tree ĐẦY ĐỦ đã khai báo trong `router.tsx` (đừng thêm route mới ở đây trừ khi thực sự thiếu): `/sign-in`, `/sign-up`, `/sign-up/check-email`, `/forgot-password`, `/forgot-password/sent`, `/reset-password`, và (sau `RequireAuth` + `AppShell`) `/`, `/v/:vehicleId/{home,history,costs,log-entry}`, `/settings`, `/onboarding/add-vehicle`.
- `client/src/components/auth/*` + `client/src/pages/auth/*` — TOÀN BỘ màn Auth đã xong, hoạt động qua MSW (cookie thật qua Service Worker). Đây là MẪU về style/convention cho các trang khác (xem `AuthLayout.tsx` cho card style, `PasswordInput.tsx`/`GoogleButton.tsx` cho cách viết component nhỏ).
- shadcn/ui components đã cài: button, card, sheet, dialog, progress, switch, toggle, toggle-group, badge, avatar, input, textarea, label, select, separator, skeleton, sonner, scroll-area, dropdown-menu. Icon library: `lucide-react`.
- Theme màu/font đã cấu hình trong `client/src/index.css` (đọc file này để biết token có sẵn): accent xanh `--primary:#0638CD`, vàng cảnh báo `--color-warn-bg/border/fg`, border nhạt `--color-border-subtle`, font `--font-sans` (Archivo, mặc định), `--font-display` (Inter Tight, dùng cho text CTA nhấn mạnh qua `[font-family:var(--font-display)]`).

**CẦN KIỂM TRA TRƯỚC (rất có thể đã xong khi bạn đọc memo này — 1 agent nền đang làm lúc bàn giao):**
- `client/src/lib/deviceId.ts`, `client/src/sync/*.ts` (types/push/pull/applyChange/bootstrap.../autoSync/syncOrchestrator), `client/src/components/layout/SyncStatusBadge.tsx` — brief đầy đủ đã giao cho 1 agent nền, có thể đã xong hoặc dở dang. **Chạy `ls client/src/sync/ 2>&1` và đọc `client/src/App.tsx` trước** để biết đã có chưa. Nếu CHƯA có hoặc dở dang, đây là việc ưu tiên làm TRƯỚC vì `SettingsPage`/`AppShell` (việc tiếp theo) cần import `SyncStatusBadge`. Yêu cầu chi tiết nếu cần làm lại: đọc kỹ `.docs/sync-api-contract.md` mục 2.12/2.13 + `client/src/mocks/handlers/push.ts`+`pull.ts`+`db.ts` (để biết server giả kỳ vọng gì, đặc biệt field `base_server_seq` trong `PushMutation` dùng để phân biệt `applied` vs `conflict_resolved`), rồi viết: outbox writer đã có sẵn (`data/outbox.ts`), chỉ cần viết push (coalesce mutation cùng entityId, gọi `api.pushMutations`, xử lý 5 loại `MutationResultStatus`), pull (vòng lặp `after_seq`/`watermark`/`has_more`, chỉ nâng `syncMeta.lastSeenSeq` SAU KHI transaction lưu xong 1 trang), `syncOrchestrator.runSync()` (push rồi pull, cập nhật `useSyncStore`), `autoSync.startAutoSync()` (foreground+online+quá 15 phút, gọi từ `App.tsx`).

**CHƯA LÀM (placeholder `ComingSoon`/tối giản, việc chính còn lại):**
- `client/src/components/layout/AppShell.tsx` — hiện chỉ render `<Outlet/>`, CẦN làm shell responsive thật (sidebar 240px cố định ở desktop ≥1024px thay tab bar, bottom tab bar 4 mục Home/History/Costs/You ở phone/tablet <1024px, vehicle switcher chip trên cùng, nút "Log service" nổi bật) — xem markup gốc dòng 221-320, 513-517 trong `design-decoded-reference.html`.
- `client/src/components/layout/VehicleSwitcher.tsx` (mới) + `client/src/components/sheets/SwitchVehicleSheet.tsx` (mới) — dùng shadcn Sheet (đã cài), style responsive bottom-sheet (mobile/tablet) / dialog giữa màn hình (desktop) BẰNG className Tailwind (Sheet và Dialog của shadcn/Radix dùng chung primitive Dialog, KHÔNG cần dựng 2 component riêng — chỉ cần style theo breakpoint, xem CSS gốc dòng 156-215 `design-decoded-reference.html` để lấy đúng số đo).
- `client/src/pages/onboarding/AddVehiclePage.tsx` — form tạo xe đầu tiên (tên + biển số optional) dùng `createVehicle()` từ `data/repositories`, xong thì `setLastVehicleId()` (từ `lib/lastVehicle.ts`) + điều hướng `/v/{id}/home`.
- `client/src/pages/HomePage.tsx` + `components/home/*` (mới: OdometerCard, OverdueSection, DueSoonSection, RecentlyLoggedSection, ReminderListItem) — dùng `useCurrentOdometer`, `useReminderStatuses`, `useHistoryEntries` (lấy 2 gần nhất). Cần `UpdateOdometerSheet` (mới, `components/sheets/`) gọi `addOdometerLog()`.
- `client/src/pages/HistoryPage.tsx` + `components/history/*` — dùng `useHistoryEntries`.
- `client/src/pages/CostsPage.tsx` + `components/costs/*` — dùng `useMonthlyCosts`, `useCostPerKm`. Bar chart chỉ cần div CSS đơn giản như prototype gốc (dòng 363-370), KHÔNG cần thêm thư viện chart.
- `client/src/pages/SettingsPage.tsx` (hiện có bản tạm chỉ có nút Sign out — thay bằng bản đầy đủ) + `components/settings/*` — AccountCard, GarageList (dùng `useVehicles` + `archiveVehicle`/`restoreVehicle`/`deleteVehicle`), ReminderSettings (chỉ hiển thị ngưỡng due_soon READ-ONLY + toggle "Ask for odometer"/"Quiet hours" là local-only UI prefs, chưa cần lưu đâu ngoài localStorage nếu muốn), AppSettings (Units km/mi local-only + row Sync dùng `<SyncStatusBadge/>`).
- `client/src/pages/LogEntryPage.tsx` + `components/log-entry/*` — 2 bước Fuel/Service (xem mục "Sửa lệch" ở trên), dùng `addFuelLog()`/`addServiceLog()` từ repositories, đọc PartType active từ Dexie (`db.partTypes.where('active').equals(true)` hoặc query tương tự) cho bước chọn part type.

## Quy tắc bắt buộc khi tiếp tục

- **Kiến trúc phân lớp**: `domain/` (thuần, test không cần DOM/DB) → `data/` (Dexie) → `sync/` → `api/` → `stores/hooks` → `pages/components`. Component KHÔNG được gọi thẳng Dexie (phải qua `data/queries`), KHÔNG tự tính reminder status (phải qua `domain/reminder.ts`).
- **Field naming**: Dexie/domain object = camelCase (`vehicleId`, `intervalKm`...). Wire format (outbox.payload, request/response API) = snake_case (`vehicle_id`, `interval_km`...). Mapping 2 chiều tập trung ở `data/mappers.ts`.
- **KHÔNG dùng TS `enum`** — tsconfig có `erasableSyntaxOnly: true`. Dùng union string literal type.
- **`verbatimModuleSyntax: true`** — mọi import chỉ dùng cho type phải viết `import type { X } from '...'` hoặc `import { type X } from '...'`.
- Alias `@/` → `src/` đã cấu hình ở `tsconfig.json`, `tsconfig.app.json`, `vite.config.ts` — dùng import `@/...`, đừng dùng relative path dài.
- **KHÔNG ghi file `.env*`** — bị chặn bởi permission settings của harness này (Write/Bash đều bị từ chối). `ENABLE_MSW` đã mặc định bật ở mọi dev build nên không cần file này để chạy.
- **KHÔNG chạy `npx shadcn init` lại** — nếu cần thêm component shadcn mới, chạy `npx shadcn@latest add <tên>` bình thường (đã fix xong lỗi alias `@` sinh thư mục sai — giờ ghi đúng `src/components/ui/`).
- Nếu chia việc cho nhiều agent chạy song song trong CÙNG thư mục (không có worktree cô lập): PHẢI đảm bảo mỗi agent chỉ đụng file/thư mục KHÔNG trùng nhau (vd 1 agent lo Home+AppShell+VehicleSwitcher, 1 agent khác lo History+Costs+Settings, 1 agent khác lo Log-entry — 3 nhóm này không đụng file của nhau, nhưng đều có thể ĐỌC `data/`, `domain/`, `hooks/`). Dặn rõ từng agent: không sửa `router.tsx`, không sửa `App.tsx`, không `npm install`/sửa `package.json` trừ khi thật sự cần thêm dependency — nếu cần, tự làm trước khi fan-out để tránh đụng `package-lock.json` cùng lúc.
- Sau mỗi thay đổi lớn: `cd client && npm run build && npm run test && npm run lint` — cả 3 phải sạch trước khi báo hoàn thành.

## Việc cần làm tiếp (theo thứ tự)

1. Kiểm tra `client/src/sync/*` đã có chưa (agent nền có thể đã hoàn thành) — nếu chưa/dở dang, hoàn thiện trước (xem chi tiết yêu cầu ở mục "CẦN KIỂM TRA TRƯỚC" trên).
2. Song song 3 nhóm việc KHÔNG đụng file nhau: (A) AppShell + VehicleSwitcher + SwitchVehicleSheet + AddVehiclePage + HomePage + UpdateOdometerSheet, (B) HistoryPage + CostsPage + SettingsPage, (C) LogEntryPage. Có thể tự làm tuần tự nếu không muốn dùng subagent.
3. Verify toàn bộ end-to-end thủ công qua `npm run dev` (không có trình duyệt/Playwright trong môi trường này lúc bàn giao — nếu môi trường mới có, hãy thực sự click-test luồng: sign up → check email → sign in → add vehicle → set reminder → log service/fuel → xem Home/History/Costs cập nhật → bấm "Đồng bộ ngay" → mở tab thứ 2 cùng account → sync → thấy dữ liệu hội tụ).
4. Cân nhắc thêm `vite-plugin-pwa` (service worker/manifest) — KHÔNG bắt buộc cho MVP, có thể để cuối cùng.
