# F08 и пользовательские инструменты

15 октября 2026. Владелец закрыл F07 после приёмки 2.0.10 и разрешил F08, новые тайлы, назначаемые горячие клавиши, системный журнал и отдельные отчёты неисправностей.

## Increment 1: явные метрики и authority сессии

- Удалены `SurgicalHealPerformance` / `ExportPerformance`: prototype instrumentation и чтение private storage больше не применяются. Heal/Export/Topology/Geometry принимают явный MetricsSink, по умолчанию no-op. Фоновый экспорт/сравнение не сбрасывает метрики Doctor. Loader возвращает длительность; счётчики выбранной модели обновляются только после принятия результата App.
- Публичный `SurgicalHealEngine.getMemoryUsage()` считает unique backing buffers snapshots/restore/preview. Геометрия считает Morph/Index/Interleaved arrays и Mesh/Line/Points с общими backing buffers, не только длину первого subarray. Категории могут пересекаться по владению; складывать их в process RAM нельзя.
- Освобождённые pristine/reopened геометрии не показываются как retained bytes. Измерения рабочих объёмов остаются в export performance result. Текущие и сохранённые export buffers считает App, который реально их удерживает.
- AssetSession владеет borrowed root/source и serial загрузки. ExportCoordinator объединяет authority revision, busy и cached result. Stale completion не может публиковаться или разблокировать более новую операцию. Save использует тот же ticket. Существующие fingerprint/verification/revision guards остаются.
- RED: три проверки обнаружили прежний неверный счёт backing buffers, пропуск Line и отсутствие isolated sink. После исправления unit/integration **339/339 PASS**, TypeScript PASS. Production focused **9/9 PASS, 41.7 с**, включая CSP/offline Draco, PARTIAL/REGRESSION/Undo, stale preview/export и 500 001 triangles performance/fidelity.
- Один development запуск дал 8 PASS / 1 FAIL: production CSP блокирует Vite dev bootstrap, поэтому UI не появился. Это ошибка выбора режима harness; повтор сделан на свежем production build без ослабления CSP. Логи обоих запусков сохранены.

## Increment 2: назначения горячих клавиш

- Локальные сохраняемые назначения для Frame/Focus, Play/Pause, Wireframe, Undo, rig Redo, Open, Skeleton, Grid, Auto Rotate и будущих команд журналов. Settings: запись сочетания, отключение, reset и видимый отказ конфликта/недоступного сочетания/storage failure. Используются physical codes для русской раскладки.
- Единственный Doctor shortcut handler; удалён захватывающий Space handler AnimationTimeline. Compare владеет своими Play/Frame/Rotation/Open; общий skeleton/render остаётся общим. Modal/input/composition/repeat и keyboard activation кнопок защищены.
- TypeScript PASS; unit/integration **344/344 PASS**. Browser: новый тест сначала показал отсутствие назначения, затем custom/persistence/conflicts и modal/Compare playback **2/2 PASS**; ещё пять Compare usability проверок PASS. Первоначальный тест ошибочно ожидал остановленное воспроизведение по умолчанию: fixture запускает клип автоматически; тест теперь явно останавливает воспроизведение до открытия Settings.

## Increment 3: пол из пакета владельца

- Найдены все 11 PNG после перемещения архива в указанную владельцем папку. SHA256 каждого `public/tiles/*.png` совпадает с соответствующим entry Tiles.zip. Изображения не переработаны; размеры 1408×768 / 2048×2048, inventory в `public/tiles/source-manifest.json`.
- Grass/Road/Sand заменяют прежние процедурные варианты в тех же IDs; удалены их старые генераторы. Остальные восемь изображений добавлены вариантами. Единый каталог Doctor/Compare, 19 уникальных поверхностей включая Grid/None и прежние остальные полы. Несквадратные изображения сохраняют пропорции повторения. Это цветовые карты; normal/roughness данные не выдумывались.
- Загружаются только активные изображения. Ref-counted pool делит Texture/Bitmap между Doctor/Compare, отменяет pending fetch и закрывает bitmap после последнего release, включая позднее завершение decode. Повторный выбор того же пола не перезагружает изображение. Старые model/export данные не меняются.
- TypeScript PASS; unit/integration **346/346 PASS**, focused floor + F06 ownership **4/4 PASS** до усиления ожидания реального decode в visual capture. Во время разработки исправлено затенение имени decoder в default constructor; промежуточные отказы сохранены. Финальная production проверка ещё впереди.

Остальные increments и полная поставка в работе. Windows native EXE автоматически не запускается. F09 не включён.
