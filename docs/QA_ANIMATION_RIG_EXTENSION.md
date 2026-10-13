# Animation Rig Extension — QA и ручная приёмка

Дата: 2026-10-13. Windows/Tauri Desktop, версия остаётся **0.0.0**. PASS 1–6 реализованы; ручная приёмка финальной сборки открыта. PASS 7 (полуавтоматический fitting) вынесен в отдельный проход после приёмки ручного редактора.

## Реализовано

- Одна кнопка-молния показывает X-Ray соединения и суставы. Выбор мышью/иерархией, подсветка и имя выбранного сустава.
- Edit Skeleton изменяет реальные локальные transforms и компенсирует inverse bind matrices для сохранения базовой формы skinned-меша. Gizmo: перемещение/вращение, Local/World, начало/конец кости; числовые поля, длина выбранной ветви, Follow/Hold, Undo/Redo/Restore Original. Один завершённый drag — одна запись истории.
- Pose Preview хранит временную позу отдельно. Вращения нескольких суставов накапливаются; выход/Stop возвращает авторский Rest Pose. Gizmo следует за текущим анимированным суставом. После перестройки mixer завершение клипа без Loop обновляет состояние Play.
- Playback Speed 0.25–2× влияет только на просмотр. Export Duration изменяет выбранный клип; LINEAR/STEP/CUBICSPLINE сохраняются, производные cubic масштабируются, общие массивы отделяются. Undo возвращает исходные данные.
- Edited GLB создаётся отдельным worker путём: исходный документ патчится по каноническим node/channel связям. Геометрия, изображения, материалы, extras, порядок joints и нетронутые клипы сохраняются. Runtime metadata остаются вне сериализуемого userData.
- VERIFIED требует проверки исходных байтов/JSON, разрешённых replacement streams и их метаданных, свежего импорта, rest/IBMs/анимаций и фактического положения **каждой вершины** в Rest Pose и шести фазах каждого клипа. Это выборка анимации, а не доказательство всех промежуточных моментов.
- Pending Save проверяет актуальность результата непосредственно перед записью: смена модели, изменение geometry/rig/clips или активный жест отменяют запись. Cancel/Error не очищают защиту несохранённых изменений. Gizmo блокируется во время Repair/Export.

## Результаты

| Проверка | Результат | Доказательство в пакете |
|---|---|---|
| TypeScript | PASS | evidence/final-typescript.log |
| Unit/regression | **192/192 PASS** | evidence/final-unit.log |
| Полный production UI suite | **36/36 PASS**, 1.4 мин | evidence/final-production.log, final-production-report.json |
| F01/F03/F05/F02, Compare, native confirmation guards | PASS в полном suite | Те же логи; отдельные file-write guards также в unit |
| Rust/Tauri check | PASS | evidence/desktop-check.log |
| Финальный Tauri release + NSIS | **PASS**, release 2 мин 18 с, NSIS 3.51 MiB | evidence/final-desktop-build.log, SHA256SUMS.txt |
| Реальные Fox и RiggedSimple: Import → Edit → Retime → Export → Reimport | PASS | evidence/production-proof/*-edited.glb, *-editor.png |
| Реальный Windows/Tauri Fox: worker → native Save → Reimport | PASS для проверенного промежуточного билда | evidence/native-save-open.json, native-saved-check.json, native-fox-*.png; models/Native_Fox_edited.glb |
| Последние изменения накопления Pose/gizmo/mixer + финальный EXE | UI suite PASS; **ручная Windows проверка ожидается** | rig-preview regression; ПК возвращён владельцу, финальную сборку автоматически не запускали |

Реальный Fox: 24 joints, 3 clips, текстура и skin. Root перемещён на +0.05 по X и повёрнут на 15° по Z. Длительность Survey увеличена вдвое: **6.833333492279053 s**; Walk **0.7083333134651184 s**, Run **1.1583333015441895 s** не изменились. Worker проверил **32 832** положений вершин (1 728 × (1 + 6 × 3)), sourcePreserved=true. Владелец сохранил файл через системный диалог; сохранённый GLB открыт заново в Tauri с теми же transforms/durations. Первоначальная диагностика UI показывала неверный clipCount; исправлено заполнение summary и добавлена UI-проверка реального числа клипов.

Синтетические сценарии покрывают разветвлённые цепочки, общие cubic samplers/accessors, morph channels, nonuniform transforms, interleaved/sparse исходные данные, rigid attachments, terminal guides, index/normal/weight repair, исходные non-unit weights, arbitrary extras и загрязнение legacy runtime metadata. Повреждение исходных/новых байтов, IBMs, rest TRS и active metadata отклоняется.

### Производительность F02

Контроль: 500 001 треугольник, production frontend, headless Edge/Playwright, один test worker. После Repair — 500 000 треугольников; Undo — 500 001; Export/Reimport — 500 000, author extras сохранены. PerformanceObserver собирал longtask отдельно при Repair/Undo/Export. Все три массива **[]**: не зарегистрировано непрерывных задач от 50 мс; бюджет ≤100 мс соблюдён. Значение max=0 в JSON — максимум пустого массива, **не измеренная нулевая длительность работы**. Это регрессионный контроль прежнего F02, не обещание того же бюджета для всех операций нового редактора/любых файлов. Артефакты: evidence/performance-summary.json и production-proof/01–03.

## Независимое ревью и закрытые риски

Проведены отдельное контрактное ревью и два авторизованных read-only ревью Codex CLI. Сырые CLI отчёты сохранены; их ссылки/номера строк относятся к состоянию до исправлений. Финальный код после последних UI изменений проверен перечисленными тестами; повторное полное CLI ревью не проводилось.

| Приоритет | Находка | Исправление и доказательство |
|---|---|---|
| P1 | GLTFLoader нормализовал испорченные replacement weights и мог скрыть потерю active accessor/view metadata | Проверка точных сериализованных bytes/descriptors до reimport; corruption regressions в RigVerificationTests |
| P1 | Расширенные импортированные terminal extras теряли неизвестные поля при другом edit | Принимается только известная точная схема guide; прочие extras сохраняются без перезаписи; source export regression |
| P1 | Pending Save мог принять результат при незавершённом gesture без новой revision | isGestureActive + exact current-result guard, блокировка gizmo; unit native write refusal и UI stale-worker regression |
| P2 | Rejected Hold drag оставлял handle в отклонённой позиции | Обновление после завершения mouseUp; реальный pointer regression проверяет bone/handle/history |
| P2 | Preview другого сустава сбрасывал предыдущую временную позу; handle не следовал анимации; rebuilt mixer не уведомлял о завершении | Сохранение live preview при uncache, frame-follow, общий finished listener; rig-preview.spec.ts |

P0 не выявлены. Гарантии экспорта основаны на разрешённом контракте ниже, а не на поддержке всех возможных расширений glTF.

## Ограничения

- Сохраняемое редактирование: импортированный self-contained GLB с одной сценой и поддерживаемыми каноническими transform/morph channels. Внешние ресурсы, неоднозначные/пропущенные каналы и неизвестная семантика изменяемых accessor/view extensions дают явный отказ.
- Поддерживаются четыре skin influences на вершину. Worker не доказывает GPU-поддержку KTX2/BasisU; неподдерживаемый импорт/verification не получает VERIFIED.
- Hold сохраняет world transforms дочерних joints только когда результат представим без shear/изменения scale. Non-joint attachments или несовместимые transforms отклоняются атомарно. Follow перемещает rigid attachments вместе с родителем.
- Вращение World при неподходящем nonuniform parent может быть отклонено. Длина указана в локальных единицах. Конечная точка leaf — сохраняемый ориентир extras.assetDoctorRigTip; она не добавляет deforming joint и не меняет веса.
- Компенсация сохраняет skinned Rest Shape; анимационные transforms перебазируются с сохранением относительного локального движения. Перемещение pivot может изменить анимированную траекторию поверхности: оцените её в Pose Preview.
- Combined Draco geometry repair, remap числа вершин и strip/fan repair: сначала **Repair → Export → Reimport**, затем Edit Rig. Совместимые index/normal/weight repairs проверяются совместно. Старый Repair export остаётся доступен.
- Автоматический fitting, F04–F09, >700k optimization и Unified Viewport не реализованы в этом проходе.

## Ручная приёмка владельцем

1. Запустите поставляемый EXE самостоятельно. Откройте models/Fox.glb. В Rig нажмите молнию: joints и links должны быть видны сквозь меш; выберите сустав мышью и через иерархию.
2. В Edit Skeleton подвигайте Root/дочерний сустав gizmo, поверните в Local/World, измените длину ветви и конец leaf. Проверьте Follow/Hold, один Undo на drag, Redo и Restore Original. При отказе handle должен вернуться к суставу.
3. Сделайте небольшой author edit. Перейдите в Pose Preview, поверните два разных сустава: первая временная поза должна сохраниться. Включите клип, проверьте деформации и движение handle. Stop/возврат в Edit должны восстановить отредактированный Rest Pose. Отключите Loop: завершение клипа должно вернуть Play.
4. Измените Playback Speed: она не должна менять экспортируемую длительность. Измените Export Duration только Survey, проверьте Undo/Redo и неизменность Walk/Run.
5. Verify Edited GLB → VERIFIED → Save Edited GLB. Сначала Cancel: файл не должен появиться, изменения остаются несохранёнными. Затем сохраните в новый путь и откройте GLB заново: joint transforms, выбранная длительность, остальные clips, текстуры и базовая форма должны сохраниться. Просмотрите все клипы.
6. Повторите на RiggedSimple и собственном персонаже. Проверьте Compare, переключение отображения и Repair/Undo. Для сложного несовместимого repair используйте последовательность из ограничения выше. Не перезаписывайте оригиналы.

Приёмка ещё не объявлена завершённой. Следующие проходы не начинаются до решения владельца.

## История и источники

Ветка: codex/review-tauri-readiness. Последняя принятая точка до расширения: f744a3f (F02). Инкременты: acdb01b (Inspector), c6ab58c (Rest/Clip core), 7940577 + e6c70d7 (native save validity), 903456d (interactive editor), 096a990 (source GLB/verification), затем отдельный integration/QA commit. Точные final HEAD/remote и hashes приложены в BUILD_INFO.txt; push обычный, без merge main/force. Ранние QA_RIG_* — исторические отчёты отдельных инкрементов.

Проверены код установленных Three.js 0.186.1 и официальные контракты: [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), [SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html), [Skeleton](https://threejs.org/docs/pages/Skeleton.html), [TransformControls](https://threejs.org/docs/pages/TransformControls.html). Реальные fixtures: [Fox](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox), [RiggedSimple](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/RiggedSimple); оригинальные README/авторство/лицензии в models/credits.
