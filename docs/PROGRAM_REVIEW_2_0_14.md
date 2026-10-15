# Общее ревью Asset Doctor после F09

15 октября 2026. Проверена программа на базе F09 / 2.0.13 (`21801b7`) по поручению владельца. Исправления — отдельный этап 2.0.14; поставка F09 сохранена. Ревью охватывает основные подсистемы и их границы, а не является формальным доказательством отсутствия всех возможных дефектов.

## Подтверждённые дефекты и исправления

| ID | Проблема | Исправление и проверка |
|---|---|---|
| R01 | Frame/Raw/Focus учитывали только вертикальный угол камеры. В узком Doctor часть модели выходила за экран; Compare Grid имел тот же дефект. На fixture максимальная экранная координата была 1.624 в Doctor и 1.174 в Grid при допустимом модуле ≤1. | Общая небольшая функция считает расстояние по восьми углам bounding box с учётом обоих углов обзора, zoom и направления. Grid использует размеры своей ячейки, Lineup — своего viewport. Реальные browser cameras проверяются по проекциям углов. Дополнительно 18 сочетаний aspect/zoom/direction проверены через Three.js projection. |
| R02 | BoundsCalculator пропускал Line/Points и учитывал видимых потомков скрытых групп. | Включены геометрии линий и точек; скрытые и служебные поддеревья отсекаются целиком. RED: линия/точки давали bounds [0,0,0]…[5,0,0] вместо [-12,-4,-2]…[25,2,4]; скрытая группа растягивала границы до x=105. Два точных теста воспроизводят и закрывают дефекты. |
| R03 | В обычном Doctor завеса импорта включалась на переносе текста/внутренних элементов и не имела очистки при отмене. | Завеса появляется только для Files, очищается на dragend/drop/blur/Escape и смене Doctor/Compare; переход между дочерними элементами не вызывает ложного ухода. Проверено воспроизведение на исходном Viewport 2.0.13 и восстановление исправленного файла; регрессия проверяет настоящие DOM drag events. |
| R04 | Диагностика CUBICSPLINE читала касательные вместо значений ключей. Ошибочны displacement/rotation корня, соседние скачки позиции и определение статичных каналов. | Читается центральный блок каждого ключа. Статичность учитывает действующие Hermite tangents и длительность интервала; неиспользуемые крайние tangents игнорируются. Пять тестов: translation 20, rotation 90°, движение между равными ключами, неподвижная кривая с неиспользуемыми tangents, малая производная на длинном интервале. Ключи и файлы не меняются. |
| R05 | Некорректный ответ compute worker мог вызвать исключение в обработчике message либо принять success с неверным типом. Null оставлял операцию до timeout. | Проверяется envelope до обращения к полям. Немедленный явный отказ завершает операцию, уничтожает worker и освобождает ByteBudget. Четыре fault-сценария проверяют отсутствие исключения события, явный отказ и нулевой резерв. Обычные worker jobs и независимая верификация сохранены. |
| R06 | Rig export создавал и удерживал развёрнутый JSON всех animation samples и создавал его заново при каждом stillCurrent. Это повторяло источник лишней памяти, устранённый ранее только в истории поворотов. | Повторно используется точное числовое сравнение с уже существующим независимым snapshot. Удалены текстовые копии и лишние packClips для freshness check. Проверены raw edits значений, времени, имени, duration и interpolation без session revision: каждый инвалидирует результат, точное восстановление возвращает актуальность. Тест изолирует freshness от verifier; настоящий GLB roundtrip проверяется полным browser/unit набором. Нового количественного обещания расхода памяти для любого GLB нет. |
| R07 | cargo fmt --check, обязательный в Windows CI, падал на debug_log/lib/startup_trace. | Только форматирование трёх Rust-файлов отдельным commit `88c8ac9`; CI gate теперь проходит. Порядок действий приложения не менялся. |

## Охват ревью

| Подсистема | Проверенные границы и доказательства |
|---|---|
| App / AssetSession / ExportCoordinator | Запросы загрузки, смена модели во время анализа и ремонта, stale publication, busy/ref guards, защита несохранённых изменений, native save/cancel. Существующие import-race/export/Undo сценарии сохранены. |
| Import / source audit / admission | Self-contained GLB/glTF, запрет внешних model resources, file/packet/worker/history budgets, 8 Compare slots, сохранение прежней модели при отказе. Нет изменения лимитов. |
| Analysis / Health / Fitness | Полнота и UNKNOWN, кэш F09, сохранение технических findings, CUBICSPLINE, ручные замечания без автоматического исправления данных. |
| Rig / animation / fitting | Авторский Rest и временная Pose, локальные/мировые правки, Follow/Hold, Undo/Redo, удаление суставов/цепей, source/bind/material/texture fidelity, независимая deformation verification. Новая логика измерения не переписывает анимации. |
| Heal / Safe Queue / export | READY preview, актуальность snapshot, независимый postcheck, PARTIAL/REGRESSION не сертифицируются, сохранение Undo при отказе, проверенный export/reimport. |
| Viewer / Compare / resources | Doctor suspension, Grid/Lineup, камеры и границы, drag/drop, presentation transforms, GPU/ImageBitmap ownership, shared floor leases, offline textures/decoders. |
| UI / platform / reports | Доступность основных контролов на 1024/1440/3840, modal/input safety, назначение клавиш и конфликты, bounded local logs, single/bulk reports и native cancellation. |
| Native / build / security | Tauri capabilities и CSP, bounded local JSONL IO, read-only startup trace stages, lockfile build, Windows formatter gate. Поиск опасных HTML/eval/произвольных сетевых вызовов в product-коде не выявил нового исполняемого пути. npm audit: 0 известных уязвимостей на момент проверки. |

## Проверки поставки

- **PASS** TypeScript и **384/384** unit/integration.
- **PASS 108/108**, **221.6 с**: fresh production headless Edge, без skipped/flaky/unexpected. Включены все прежние 105 сценариев, три review-регрессии и F09.
- **PASS 4/4** Rust unit tests и cargo fmt --check.
- **PASS** Проекции всех проверенных углов: Doctor Frame/Raw max |NDC xy| = **0.741**, Focus **0.625**, Grid/Lineup **0.800** (границы экрана ±1). Просмотрен PNG `29-review-frame-small.png`; повторно просмотрен RU профиль на 1024px. Проверены 18 сочетаний aspect/zoom/direction в unit-проверке.
- **PASS** Прежние ≤100 мс gates. В текущих Repair/Undo/Export/Fitting замерах не наблюдались long tasks ≥50 мс; это не утверждение о нулевой работе main thread.
- **PASS** Windows EXE/NSIS x64 build: release compile **2 мин 38 с**, installer **61.35 MiB**. Версия ресурсов EXE проверяется при упаковке; EXE/installer не запускались.

В evidence извлечены **65** PNG/JSON artifacts. npm audit JSON сохранён: info/low/moderate/high/critical = 0. GitHub-hosted CI в этом проходе не запускался; его локальные TypeScript/unit/browser/native/format gates выполнены здесь. Push в рабочую ветку не равнозначен выполнению workflow для main.

Доказательства сохраняются в `work/review-2-0-14` рядом с repo: первоначальные RED для bounds/камер, отдельный исправленный RED для завесы на source 2.0.13, cubic-red, worker-red, rustfmt-red, focused browser reports, npm-audit.json и итоговые отчёты. Первый общий RED завесы использовал неточную строку locator; он не считается доказательством дефекта. Для этого сохранён отдельный curtain-red с правильным locator и исходным Viewport.

## Границы

Native EXE/installer автоматически не запускаются; повторной серии видимых native запусков в этом этапе нет. Реальная ручная приёмка остаётся за владельцем. Редкое прежнее startup hang не объявляется диагностированным заново. Частные модели не изменяются и не включаются в поставку. Исходные требования F09 и все принятые функции F08 сохранены.

Сборка продолжает выводить известные предупреждения Three.js о deprecated Clock/PCFSoftShadowMap и размерном Vite chunk. Эти предупреждения не являются найденным отказом и не подавлялись изменением gate или отключением проверок. Нового архитектурного переписывания App и нового product scope не вводится.
