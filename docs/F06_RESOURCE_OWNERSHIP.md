# F06 — владение и освобождение ресурсов, 2.0.7

F04 / 2.0.6 принят владельцем. F06 реализован и технически проверен; ручная приёмка Windows-сборки 2.0.7 впереди.

## Реализовано

- `ModelResources` собирает Mesh, Line/LineSegments и Points: уникальные геометрии, текущие и authored материалы, текстуры из всех слотов и вложенных shader uniforms/THREE.Uniform, скелеты и ImageBitmap. Циклы и повторные ссылки не приводят к повторной очистке.
- Import регистрирует владение до публикации, включая ресурсы остальных parsed GLTF scenes. Failed-resource/stale imports, Doctor, Compare, export и независимая reimport verification освобождают модели через один путь.
- Root leases/refcounts хранятся в WeakMap вне userData. Compare владеет клонированными материалами/скелетами и удерживает общие геометрии/текстуры/decoded images. Исходник может освободиться раньше клона: общий ресурс остаётся живым до последнего владельца.
- Rig регистрирует новые/отсоединённые геометрии и static mesh variants: Undo/Redo не лишается своих streams. История удерживает их до освобождения модели. Heal cleanup не освобождает геометрию, пока она принадлежит зарегистрированной модели.
- Skeleton.dispose освобождает поздно созданную renderer boneTexture. Bitmap закрывается после GPU release, ровно один раз после последнего владельца.
- Presentation overrides восстанавливаются до release. Менеджер материалов забывает старые меши; Doctor удаляет старые clips и render lists. Helper геометрии/материалы, lights/shadows, собственный environment и временные transmission render targets очищаются. Кэш процедурных floor textures живёт до последнего SurfaceManager; общий кэш не очищается при закрытии одной из нескольких сцен.
- При окончательном уничтожении viewport очищаются оставшиеся helpers и теряется его WebGL context. Переключение Doctor/Compare и замена модели не уничтожают живой viewport.

UI и fitting-алгоритмы этого шага не менялись. Бюджеты памяти F07 не вводились.

## Воспроизведённые дефекты

RED unit: повторный release общих геометрий/материалов/обычных textures, пропуск shader textures и skeleton boneTexture, отсутствие отдельного материала Line-клона Compare. Сохранён `unit-red.log`.

Реальная WebGL регрессия Compare после начальной унификации: второй import/Grid/Lineup/remove цикл увеличивал остаток с **12 до 24 геометрий**, с **37 до 73 textures**. Сохранён `compare-resource-red.log`. Проверка выявила неполную очистку ламп/теней/transmission targets и неработающее `isGridHelper` условие: установленный Three r186 не выставляет этот флаг. Очистка grid использует фактический класс GridHelper.

Three r186 не предоставляет scene-level API удаления transmission targets. `SceneRenderResources` использует публичные object.onBeforeRender/getRenderTarget: opaque probe с нулём вершин наблюдает текущий target без draw. Он находится в частной viewer scene вне authored asset; Shadow pass использует другой callback и принадлежит lights. Targets освобождаются при уничтожении этой сцены. Проверить этот механизм при обновлении Three.

## Проверки

- TypeScript PASS; **304/304** unit/integration PASS, включая шесть новых F06 случаев: общие ресурсы, скелет, Line ownership, последний владелец bitmap, detached history/other scenes, cyclic uniforms.
- Свежая production-сборка: **82/82** headless Edge browser tests PASS, **184.12 с**, без skipped/flaky/unexpected. Сохранены JSON report и 43 приложения доказательств.
- Doctor: **7** import/release циклов Mesh/Line/Points + clearcoat/transmission maps. После каждого: **6 geometries / 4 textures / 9 programs**, old authored-material entries **0**. Bitmap totals **7 created / 7 closed**, duplicate close **0**. После окончательного dispose: **0 geometries**, contextLost **true**.
- Compare: **6** циклов по две модели, по три Grid↔Lineup переключения в каждом. Изображения живы на протяжении перестроений. После полного удаления каждый раз **0 geometries / 1 texture / 0 programs**; **12 created / 12 closed**, duplicate close **0**.
- Анимированный скелет: **5** реальных GPU upload/release циклов. Каждый раз **1/1 boneTexture** освобождена, skeleton.boneTexture становится null. После очистки **6 geometries / 3 textures / 6 programs**, без роста.
- Единственная texture в пустом Compare — библиотечная **DFG_LUT** Three r186, а не изображение импортированной модели. Проверка обнаруживает её по действительным renderer uniforms. Counters не являются байтами VRAM и не обязаны обнуляться после renderer.dispose; окончательное освобождение GPU подтверждается потерей контекста.
- Полный набор сохраняет source fidelity, Rig fitting/removal/Undo, Export/Reimport, race/cancel и принятый F04 lifecycle. На 500001 triangles Repair/Undo/Export/Fitting не зарегистрировали long tasks ≥50 мс; gate ≤100 мс PASS. Пустой массив не означает нулевой стоимости операций.
- Vite production build PASS. Rust locked check PASS (3.14 с). Windows release/NSIS сборка и version/hash proof приложены в delivery.

Доказательства: `evidence/final-proof/09-doctor-resource-cycles.json`, `10-compare-resource-cycles.json`, `11-skeleton-resource-cycles.json`, общий `final-report.json`, `performance-summary.json`, unit/build/native logs.

## Границы результата и приёмка

Это проверка конкретного frontend на реальном headless WebGL, а не замер peak RAM/VRAM в байтах, процента GPU или сертификат всех драйверов/WebView2. Не выполнялись установщик и автоматический запуск EXE. F06 не закрывает admission/worker/Undo budgets F07 и orchestration F08. Зарегистрированная модель освобождается явно; weak registry не заменяет lifecycle вызов release.

1. В сборке 2.0.7 повторить открытия анимированной текстурированной модели. Убедиться, что текстуры и анимация не исчезают после смены файлов.
2. Загрузить несколько моделей в Compare, несколько раз переключить Grid/Lineup, удалить одну и затем все. Повторить загрузку. Оставшиеся модели должны сохранять свои материалы и скелеты.
3. Перейти обратно в Doctor; проверить принятую приостановку/возобновление. Проверить Rig правку/Undo/Redo и Verify/Save/Reimport.
4. Проверить смену floor presets и закрытие приложения. Не требуется ручное очищение библиотечных кэшей.

После приёмки — **F07**: ограничить Compare paths до native readFile и измерить peak памяти на import/worker/export/Undo до выбора лимитов. Полный план с дополнительными работами и оставшимися пунктами: [F01–F09](ROADMAP_STATUS_2026_10_14.md).
