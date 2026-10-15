# F08 и пользовательские инструменты

15 октября 2026. Владелец закрыл F07 после приёмки 2.0.10 и разрешил F08, новые тайлы, назначаемые горячие клавиши, системный журнал и отдельные отчёты неисправностей.

## Increment 1: явные метрики и authority сессии

- Удалены `SurgicalHealPerformance` / `ExportPerformance`: prototype instrumentation и чтение private storage больше не применяются. Heal/Export/Topology/Geometry принимают явный MetricsSink, по умолчанию no-op. Фоновый экспорт/сравнение не сбрасывает метрики Doctor. Loader возвращает длительность; счётчики выбранной модели обновляются только после принятия результата App.
- Публичный `SurgicalHealEngine.getMemoryUsage()` считает unique backing buffers snapshots/restore/preview. Геометрия считает Morph/Index/Interleaved arrays и Mesh/Line/Points с общими backing buffers, не только длину первого subarray. Категории могут пересекаться по владению; складывать их в process RAM нельзя.
- Освобождённые pristine/reopened геометрии не показываются как retained bytes. Измерения рабочих объёмов остаются в export performance result. Текущие и сохранённые export buffers считает App, который реально их удерживает.
- AssetSession владеет borrowed root/source и serial загрузки. ExportCoordinator объединяет authority revision, busy и cached result. Stale completion не может публиковаться или разблокировать более новую операцию. Save использует тот же ticket. Существующие fingerprint/verification/revision guards остаются.
- RED: три проверки обнаружили прежний неверный счёт backing buffers, пропуск Line и отсутствие isolated sink. После исправления unit/integration **339/339 PASS**, TypeScript PASS. Production focused **9/9 PASS, 41.7 с**, включая CSP/offline Draco, PARTIAL/REGRESSION/Undo, stale preview/export и 500 001 triangles performance/fidelity.
- Один development запуск дал 8 PASS / 1 FAIL: production CSP блокирует Vite dev bootstrap, поэтому UI не появился. Это ошибка выбора режима harness; повтор сделан на свежем production build без ослабления CSP. Логи обоих запусков сохранены.

Остальные increments и полная поставка в работе. Windows native EXE автоматически не запускается. F09 не включён.
