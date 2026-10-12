# F03 — Presentation Wrapper: QA

2026-10-12. База: принятые F01 `57d1994` и Native Confirm `67700db`.
Область: Windows/Tauri Desktop. Следующий этап не начат.

## Исправление

**P2 / F03:** viewer записывал rotation и ground offset в authored root;
после вращения и Rescan появлялась ложная transform-находка. Регрессионный
тест до исправления воспроизвёл изменение quaternion authored root на 90°.

Теперь структура viewer: Scene → presentation wrapper → authored root.
Doctor и Compare меняют на wrapper вращение, turntable, ground placement,
Lineup offset и presentation scale. Авторские TRS и ручные matrices сохраняются.
Framing продолжает использовать отображаемые bounds. AnimationMixer остаётся
привязан к authored root; wrapper удаляется отдельно при смене/закрытии asset.

Bounds, transform-диагностика, координаты диагностических находок и topology
cache измеряются в пространстве документа. Viewer переводит fallback focus
обратно в пространство презентации. Repair probes используют те же координаты.
Runtime wrapper хранится вне glTF extras и не попадает в экспорт.

Для skinned моделей обновляются ancestor matrices и вызывается штатный
`SkinnedMesh.updateMatrixWorld`, обновляющий inverse bind matrix. Это проверено
до первого кадра и при деформации от AnimationMixer.

## Результаты

| Проверка | Результат / доказательство |
| --- | --- |
| До исправления | RED: authored quaternion меняется; `red-fixed-probe.log`, trace/screenshot |
| TypeScript | PASS, `lint.log` |
| Unit/integration | PASS, **138/138**; `unit.log`, 8 новых проверок F03 |
| Production regression | PASS, **16/16**; `production.log`, включая F01 и Confirm/Cancel/Error |
| Целевые F03 сценарии | PASS, 4/4; Doctor / Compare / static TRS / animated skin; `final-targeted.log` |
| Tauri check / build | PASS, Windows x64 EXE и NSIS; `desktop-check.log`, `desktop-build.log` |
| Реальный Windows viewer | PASS: rotation/turntable/frame/Rescan, Compare Grid/Lineup/scale и Doctor handoff; `native-viewer.json` |
| Native Repair / Undo | PASS: Cancel сохраняет 3 tri; Confirm 3 → 2; Undo 2 → 3 без изменения authored TRS; `native-*.json/png` |
| Native Export → Save → Reimport | PASS: VERIFIED, настоящий Save, 2 tri при reopen, исходные Pivot TRS, skin indices/weights, joint и работающий клип; `native-export.json`, `native-repaired.glb` |

Windows QA: release EXE, отдельный WebView2-профиль, WebView2
`155.0.4283.45`. Измерения из живого WebView2 через CDP и read-only QA probe;
native Confirm/Cancel/Save нажаты через Windows UI automation. Import использует
встроенный file input. Browser tests проверяют frontend desktop-приложения.
Это отдельные границы проверки, не замена Windows runtime браузерным QA.

F01 export service, Native Confirm обработчик/ACL, зависимости и версия не
менялись. Исходный archived GLB fixture не изменён. Набор доказательств включает
журналы, native screenshots/JSON, source/repaired fixtures, commit patch и hashes.

**WARN:** на ширине 1366 часть Compare toolbar перекрывается slot chips;
затронутые контролы проверены через доступный keyboard path. Это UI roadmap,
не исправлялось в F03. Прежние предупреждения Three.js/Vite также остаются.
F02 performance budget этой задачей не закрывается.

**SKIP:** clean-machine установка/удаление NSIS, native Open/close,
другие GPU/DPI и произвольные пользовательские rigs. Тестовая модель содержит
один joint и один клип; это не сертификация всех skinned GLB.

## Ручная приёмка

1. Запустить новый EXE. На своём asset сохранить исходные Health-находки;
   повращать модель, включить turntable, сменить surface, Frame → Rescan.
   Viewer-вращение не должно добавлять transform warnings; авторские остаются.
2. На приложенном `authored-skinned.glb` проверить воспроизведение/скелет,
   Compare Grid ↔ Lineup, нормализацию высоты/ручной масштаб и возврат в Doctor.
3. Safe Queue: Cancel оставляет 3 tri; Confirm даёт 2; Undo возвращает 3.
   Повторить ремонт, Build & Verify → Save → открыть сохранённый GLB.
   Ожидаются 2 tri, исходный AuthoredPivot и работающий JointMotion.

F03 ожидает приёмки владельцем. Push не выполняется; остальные пункты roadmap
не реализуются до следующего задания.
