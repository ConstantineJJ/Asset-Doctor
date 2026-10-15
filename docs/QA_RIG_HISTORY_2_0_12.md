# Отказ памяти при поворотах — 2.0.12

15 октября 2026. Замечание приёмки 2.0.11: после последовательных поворотов суставов `Operation exceeds the configured memory budget (131.25 MiB; maximum 128.00 MiB)`. Исправление на той же ветке, прежняя поставка сохранена. F09 не включён.

## Что показали присланные файлы

- В системном JSONL 576 строк, две session IDs и startup traces. Последняя модель — `cute+creature+3d+model_rig-edited.glb`, 22 710 908 bytes. Последняя опубликованная rig revision — 21. Последний завершённый analysis — 05:35:31 UTC / 08:35:31 Europe/Riga. Самого отказа памяти **в журнале нет**: catches Gizmo/ручного изменения показывали сообщение, но не отправляли его в SystemLog. Ни отсутствие error records, ни завершённый analysis не означали отсутствия ошибки.
- Первый отчёт YellowCar — 132 degenerate triangles, 72 locations. Второй — 16 216 tiny index-connected components, 656 locations, MANUAL review. Это разные правила геометрии одной машины, оба scan complete. Они не описывают memory guard рига другой модели. Сам YellowCar и его находки не изменялись этим исправлением.
- Старый production frontend 2.0.11 воспроизвёл отказ на **20-й** ручной Z-ротации `mixamorigRightHand` того же GLB: **130.50 MiB / 128 MiB**. Синтетический dense animation test тоже воспроизвёл отказ **142.84 / 128 MiB**. Исходный screenshot 131.25 соответствует другому набору уже накопленных правок. Это квота приложения для истории, не измерение свободной памяти Windows.

## Причина и исправление

`rebaseClips` клонировал все tracks всех clips даже при изменении одного сустава. Каждый history snapshot дополнительно удерживал JSON signature с развёрнутыми numeric animation arrays. Именно этот избыточный retained state расходовал квоту. Guard истории появился в F07 / `ccef3a5`; F08 не вводил новую квоту.

- Неизменённые clip/track streams и sample times разделяются между immutable history states. Перезаписываемый track получает собственные values; исходные samples, прошлые Undo и caller-owned clips не мутируются. Retime/структурные изменения сохраняют свои clone contracts.
- Snapshot signature содержит маленькие rest/graph данные. Animation equality проверяется точно по metadata и samples с fast path общих массивов. Вероятностный hash не используется, числовые текстовые копии не удерживаются. Memory accounting считает backing buffers по одному разу плюс metadata/signatures.
- **128 MiB остаётся прежним**. До операции сохраняется preflight; после изменения добавлена проверка фактического candidate history до commit, с rollback при отказе. Квота не снимается, Undo не очищается ради продолжения работы.
- В бюджетной ошибке есть requestedBytes/limitBytes. Обработанные ошибки ручного rig action и всех error paths Gizmo пишут error records `action_failed` / `gizmo_failed`, с asset UUID, joint/tool/space (для Gizmo), размером/лимитом истории, Undo/Redo counts и причиной/stack. Обычные global handlers не могут увидеть пойманный UI error, поэтому используются явные события.

## Проверки

- Предварительный owner test: **40 поворотов, 40 Undo, 40 Redo и VERIFIED export PASS**; history **19 015 072 bytes (~18.1 MiB)** после 40 действий, SHA256 исходника неизменён: `68d4aa71af4f316a175860e83266b0b98241e9403d039b2afe9ddbff9ae08426`.
- Контрольный тест: 64 animated joints × 2000 samples, 40 поворотов, immutable sharing и точные все samples после Undo/Redo; retained history <16 MiB.
- Fault injection на fixture: budget=1 byte, настоящий Apply Rotation и drag кольца Gizmo. Обе операции отказывают до commit, исходные transforms/Undo сохранены; обе ошибки присутствуют в системном журнале с requested/maximum bytes. Это тест отказа, не новый product limit.

- **PASS** TypeScript и **364/364** unit/integration.
- **PASS 101/101**, **234.7 с**: fresh production headless Edge, без skips/flaky/unexpected. Включены прежние fidelity/source/CSP/performance/Compare/rig проверки и оба новых регрессионных сценария.
- **PASS 1/1**, **18.6 с**: тот же owner GLB в final 2.0.12, 40 rotation/Undo/Redo и VERIFIED export; history **19 015 072 bytes**, SHA256 неизменён.
- **PASS 1/1**, **5.8 с**: отдельная focused проверка настоящего отказа Apply/Gizmo, фильтр error и PNG с обеими структурированными ошибками. Предварительный hover-поиск кольца на маленьком RightHand owner viewport не получил picker hit; fault-сценарий использует контролируемую fixture, owner тест проверяет ручные числовые повороты. Это граница проверки, не заявленная native mouse-приёмка.
- **PASS 4/4** Rust tests. Windows EXE / NSIS x64 build PASS; native compile **3 мин 01 с**, installer **61.32 MiB**. EXE/installer автоматически не запускались.
- **PASS** прежний ≤100 мс gate на 500 001 triangle fixture. В final Repair/Undo/Export/Fitting замерах не наблюдались long tasks ≥50 мс; это не утверждение об отсутствии всей работы main thread.
- Визуально просмотрен `log-visual-proof/01-rig-budget-log.png`: обе error записи с requested/limit bytes, `gizmo_failed`, joint ID и tool доступны в фильтре error.

Доказательства в `work/rig-history-2-0-12` рядом с repo и в `evidence` новой поставки. Присланные три файла скопированы в received с SHA256, не редактировались. Частный GLB в поставку не входит. F08 ожидает повторной приёмки владельца; F09 не выполнялся.

Ручная приёмка: повторите свою последовательность правок и сохраните JSONL в конце. Если законный бюджет когда-либо будет исчерпан, в новой версии отказ должен быть виден в SystemLog с контекстом. Приложение/установщик автоматически не запускаются; тесты frontend выполняются headless.
