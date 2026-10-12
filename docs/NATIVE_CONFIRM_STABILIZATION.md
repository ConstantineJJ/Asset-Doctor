# Safe Queue — Native Confirm / ACL QA

Дата: 2026-10-12. База: принятый владельцем F01, `57d1994`.
Область: только подтверждение Safe Queue в Windows/Tauri. F03 не начат.

## Находка P1: ремонт без положительного подтверждения

На исходном Windows release EXE ошибка воспроизведена на неизменённом
`tests/browser/fixtures/two-scenes.glb`: после Run safe queue модель изменилась
с 3 до 2 треугольников без положительного ответа пользователя. В WebView2
получена необработанная ошибка `ialog|confirm not allowed by ACL`.
Это изменение in-memory геометрии; исходный GLB на диске не изменился.

Две причины подтверждены исходниками установленного плагина и runtime:

1. `tauri-plugin-dialog 2.8.1/src/init-iife.js` подменяет `window.confirm`
   асинхронным вызовом `plugin:dialog|confirm`. Native handlers в `src/lib.rs`
   регистрируют только `open`, `save`, `message`. Permission `allow-confirm`
   является deprecated alias для **message**, а не разрешением старой команды.
2. `src/App.tsx` в `57d1994` проверял `!window.confirm(...)` без `await`.
   Объект Promise считался согласием до ответа/отказа диалога.

Штатный SDK `@tauri-apps/plugin-dialog.confirm` возвращает `Promise<boolean>`
через `plugin:dialog|message`, `OkCancel`, и сравнивает ответ с `Ok`.
Контракт и права описаны в [Tauri Dialog API](https://v2.tauri.app/reference/javascript/dialog/)
и [Dialog permissions](https://v2.tauri.app/plugin/dialog/).

## Минимальное исправление

`FileIO.confirmRepairQueue` вызывает штатный SDK и ожидает ответ. App разрешает
старт только при `true`; Cancel завершает обработчик, Dialog Error отменяет
операцию и показывает объяснение EN/RU. До ответа нет preview/apply очереди.
Повторный клик не открывает второе подтверждение; ответ для заменённого asset,
изменившегося анализа или ремонта не авторизует текущую сессию.

Capability заменена с alias `dialog:allow-confirm` на `dialog:allow-message`:
эффективный набор команд тот же. ACL не расширена; vendor/Rust handlers,
экспорт F01, зависимости и версия не менялись. Веб-продукт не дорабатывался;
frontend harness используется для проверки логики desktop-приложения.

## Проверки

| Проверка | Результат и доказательство |
| --- | --- |
| Воспроизведение до фикса | FAIL безопасного поведения: `baseline.json`, 3 → 2, ACL rejection без согласия |
| Регрессии до фикса | RED: 4 сценария падали; `red.log` |
| TypeScript | PASS, `lint.log` |
| Unit/integration | PASS, 130/130; `unit.log`, включая IPC Confirm / Cancel / Error / pending |
| Production frontend regression | PASS, 12/12; `production.log`, включая F01 и 4 новых сценария |
| Cargo check / Tauri build | PASS, Windows x64 release EXE и NSIS; `desktop-check.log`, `desktop-build.log` |
| Native pending | PASS, 3 tri, без Build/Undo до ответа; `cancel-open.json`, `confirm-open.json`, native modal screenshots |
| Native Cancel | PASS, реальная кнопка «Отмена» мышью возвращает `Cancel`; 3 tri, без Undo/Build; `cancel-check.json` |
| Native Confirm | PASS, реальная кнопка OK мышью возвращает `Ok`; 2 tri, Build доступен; `confirm-check.json` |
| Native Dialog Error | PASS, реальный отказ ACL; 3 tri, без Undo/Build, объяснение, без unhandled error; `error-check.json/png` |

Native проверки выполнены на собранном release EXE с отдельным WebView2
профилем, WebView2 `155.0.4283.45`. Для измерений используется CDP внутри
Windows WebView2; native кнопки нажаты через Windows UI automation.
Cancel через Escape и OK через Enter также проверены.

Для Error только в тестовой сессии IPC fetch для `dialog|message` направлен
на старую `dialog|confirm`, которая получает настоящий отказ native ACL.
Записан ответ `Command plugin:dialog|confirm not allowed by ACL`. После
проверки перехват удалён; capability и production-код для инъекции не менялись.
Import fixture выполнялся через встроенный file input, не native Open.

SHA-256 fixture остался
`65d9e61cc389782c51b74eb6732fc98f553b68381f05d5792ea5c308e9875997`.
Снимки исходников bridge/ACL/SDK сохранены в `source-evidence.txt`.
JSON, screenshots, probe scripts и журналы упакованы в отдельные QA evidence.

**WARN:** прежнее предупреждение Vite о больших chunks остаётся. F02 и
performance budget этим исправлением не закрываются. Сборка unsigned, версия
остаётся `0.0.0`, не релиз 2.0.0.

**SKIP:** установка/удаление NSIS на чистой Windows, native Open/Save/close,
другие DPI/GPU. Заявлен PASS только проверенных Safe Queue сценариев.

## Ручная приёмка

1. Запустить приложенный новый EXE или установить новый NSIS build.
2. Открыть `two-scenes.glb`, дождаться анализа, нажать Run safe queue.
3. Пока диалог открыт, модель должна оставаться с 3 tri. Нажать «Отмена»:
   3 tri сохраняются, нового ремонта и Undo нет.
4. Повторить Run safe queue и нажать OK: должно стать 2 tri. Undo возвращает 3.
5. Проверить текст подтверждения на EN/RU. Error воспроизведён автоматической
   fault injection; в обычную сборку переключатель ошибки не добавлялся.

F01 принят владельцем. Native Confirm ожидает отдельной ручной приёмки.
Работа остановлена до этой приёмки; следующий этап F03 — Presentation Wrapper.
