# F01 — достоверность repaired GLB export

Дата: 2026-10-12. Исходный HEAD: `82f00ce0a10835ab1d5c28366eedde5564d1ab93`.
Этот документ относится к локальному коммиту, содержащему исправление F01.

Целевой продукт по решению владельца — Windows/Tauri. Отдельный web-продукт
закрыт; frontend и Playwright используются для desktop-разработки и внутренних
регрессий. Версия остаётся `0.0.0`. Публикации и push не выполнялись.

## Причина и исправление

GLTFLoader возвращает в Asset Doctor только default scene. Сравнение свежей
сцены с повторно открытым экспортом не замечало содержимое, потерянное ещё при
таком ограничении loader: две сцены превращались в одну с VERIFIED.

Source audit теперь считает все сцены и узлы вне иерархии default scene.
RepairedExportService отказывает в сертифицированном экспорте, если сцена не
единственная или не все исходные узлы достижимы. Preflight выполняется до
повторной загрузки pristine-копии и до применения к ней geometry patch.
Исходные bytes и текущая live-геометрия не меняются из-за отказа. Уже сделанные
in-memory repairs остаются доступными для Rescan/Undo; viewing multi-scene
файла не превращено в поддержку lossless multi-scene export.

После fresh reopen дополнительно сравниваются имена, типы и иерархия всех
узлов экспортируемого root, включая немешевые anchors. Serializer, потерявший
немешевой узел при одинаковых mesh counts, получает REGRESSION/nodeStructure.
Этот gate не является полной сертификацией всех свойств glTF.

Для отказов и nodeStructure добавлены объяснения EN/RU. Полноценный
multi-scene exporter не реализован. F02–F09 не исправлялись.

## Регрессии и проверки

- До изменения: browser multi-scene и orphan-node сценарии падали; single-scene
  контроль проходил. Восстановление только export service из исходного HEAD
  воспроизвело VERIFIED при искусственной потере CriticalAnchor.
- После изменения: TypeScript PASS; 126/126 unit/integration PASS.
- Production frontend build PASS; 8/8 production-browser regression PASS,
  включая три F01 сценария, Undo/unsaved/import races, Compare и offline Draco.
- Cargo check PASS; Windows release EXE и NSIS installer build PASS.
- Новый release EXE запущен с отдельным WebView2-профилем: multi-scene export
  отклонён, Rescan/Undo работают, single-scene Build & Verify доступен.
  Проверка использовала встроенный file input, не настоящий native Open.
- SHA-256 archived fixture unchanged:
  `65d9e61cc389782c51b74eb6732fc98f553b68381f05d5792ea5c308e9875997`.

**WARN:** при выполнении safe queue в release WebView2 обнаружены ошибки
`ialog|confirm not allowed by ACL`. Runtime window.confirm является async
обёрткой native dialog invoke; эта реализация, capabilities, FileIO и Rust-код
не менялись в F01. Ошибка появилась вне нового export preflight, при вызове
существующего подтверждения ремонта. Поэтому полный Desktop PASS не заявлен.
Причина native bridge/ACL требует отдельного согласованного исправления;
его не включали в F01. Операция очереди в тесте продолжилась несмотря на эту
ошибку, что также требует внимания при ручной приёмке подтверждений.

**SKIP:** установка/удаление через NSIS на чистой Windows, настоящий native
Open/Save, native close confirmation, другие GPU/DPI. Эти проверки не заменены
браузерными тестами. F02 performance budget не проверялся и не объявлен PASS.

## Ручная приёмка владельцем

1. Запустить новый release EXE или установить новый unsigned NSIS build;
   убедиться, что проверяется текущая сборка, а не бинарный файл от 5 октября.
2. Открыть/перетащить `tests/browser/fixtures/two-scenes.glb`, дождаться анализа.
3. Run safe queue: сетка меняется с 3 tris на 2. Отдельно проверить поведение
   native подтверждения; при ошибке ACL зафиксировать её, не считать этот шаг
   полностью прошедшим desktop-подтверждением.
4. Build & Verify: увидеть объяснение multi-scene ограничения. Download/Save
   проверенной копии недоступен; ложного export VERIFIED нет.
5. Rescan, Undo: сетка возвращается к 3 tris, исходный файл на диске неизменен.
6. На приложенном single-scene контрольном файле выполнить Repair → Build &
   Verify: ожидается VERIFIED. Native Save и reopen проверить вручную, включая
   сохранение `CriticalAnchor` и `CalibrationMarker`.
7. Переключить EN/RU и убедиться, что отказ понятен на выбранном языке.

F01 ожидает ручной приёмки. Следующее исправление не начинается автоматически.
Порядок оставшихся задач: F03 → F05 → F02 → F04 → F06 → F07 → F08 → F09,
затем финальная desktop/performance проверка. Native confirm/ACL warning
нужно отдельно рассмотреть с владельцем, не объединяя с текущим коммитом.
