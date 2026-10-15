# F07 — admission и ограниченные рабочие буферы, 2.0.9 / 2.0.10

15 октября 2026. База: принятая владельцем 2.0.8, `246f493`. Первый increment `4fede99` ограничил native Compare до чтения файлов. Этот этап добавляет размеры и бюджеты для конкретных retained/temporary данных; общий F08 не выполняется.

**Замечание приёмки 2.0.9:** владелец обнаружил отказ на седьмой/восьмой модели. Причина — несогласованный общий лимит 128 MiB при восьми местах по 64 MiB. В **2.0.10** общий предел исходников выводится как **8 × 64 MiB = 512 MiB**; остальные бюджеты не меняются. Повторение на реальных моделях и результаты исправления: [QA 2.0.10](QA_COMPARE_CAPACITY_2_0_10.md). F07 остаётся открытым до повторной Windows приёмки; результаты 2.0.9 ниже сохраняются как история.

## Пользовательское поведение

- Native Compare проверяет свободные места после закрытия диалога, выбирает не больше этого количества путей и читает следующий файл только после завершения импорта предыдущего. Неиспользованные пути не читаются. File drop во время native picker/import не занимает те же slots. При заполненных восьми местах диалог не открывается.
- Прочитанные bytes текущей native партии учитываются немедленно, независимо от задержки React state publication. Проверяются и исходный batch allowance, и актуальный остаток; даже неподвижный callback capacity не позволяет превысить byte allowance.
- Размер native файла проверяется через `stat` до `readFile` и повторно по фактическому результату чтения. Doctor и Compare проверяют File.size до File.arrayBuffer. Compare учитывает уже удерживаемые source buffers и новые модели текущей партии.
- Doctor loader удерживает не больше одного active и одного queued File. Третий запрос получает отказ без чтения; текущий и ранее принятый queued запрос сохраняют порядок. Каждый исходник ограничен 64 MiB.
- Карточки восьми моделей сохраняют ширину и прокручиваются горизонтально. На 1366px Lineup больше не перекрывает кнопки удаления соседними карточками.
- Превышение бюджета отклоняет новую операцию; действующая модель и прежние Undo/Redo сохраняются. История не удаляется молча ради новой правки.

## Конкретные бюджеты

Все размеры двоичные, MiB = 1 048 576 bytes. Это продуктовые operational limits, а не автоматическое определение свободной памяти устройства.

| Граница | Лимит | Что проверяется |
|---|---:|---|
| Один пользовательский файл | 64 MiB | До native чтения / File.arrayBuffer; повторная проверка полученных native bytes |
| Source buffers Compare | 512 MiB в 2.0.10; ранее 128 MiB | Восемь мест по 64 MiB; сумма удерживаемых исходников, включая текущую партию |
| Копируемая геометрия одного worker packet | 32 MiB | До array.slice в packRoot, с учётом interleaved arrays, morphs и shared geometry |
| Одновременно занятые входные binary buffers workers | 64 MiB | Общая reservation для topology, Heal, fitting, edited/repaired export; один job на ComputeWorkerClient |
| Heal Undo | 128 MiB | Уникальные retained backing buffers плюс прогноз следующей записи, до изменения index/geometry |
| Rig history | 128 MiB | Baseline/current/past/future, retained geometry variants, clip buffers и консервативная оценка rest/hierarchy records и JSON signatures; admission перед транзакцией/drag/geometry clone |

Worker reservation возвращается при ответе, error, отмене, неудаче construction/postMessage и timeout. Повторное завершение не уменьшает used второй раз. Занятый worker не накапливает очередь payloads. Topology резервирует projected extraction bytes до создания временных arrays, включая fallback/retry.

Rig учитывает также geometry variants, которые нужны source-preserving Undo и удерживаются ModelResources до закрытия модели. Прежний предел 100 шагов применяется и к завершению drag gesture. Существующие Undo/Redo/Reset не превращаются в новые экспорты и сохраняют точные состояния. Если следующая правка не помещается, нужно сохранить модель и открыть её заново; старый исходник не перезаписывается.

## Основание для лимитов и измерения

Контрольный GLB: **500 001 triangles, 251 001 vertices, 14 033 164 source bytes**, live geometry **14 032 044 bytes**, одна Heal Undo запись **20 032 044 bytes**, repaired output около **14 033 416 bytes**. Контроль помещается с запасом в 32 MiB geometry packet и 64 MiB aggregate worker input; восемь исходников занимают **112 265 312 bytes**, ниже 128 MiB. Один такой экспорт требует source + geometry около 28 MB входных binary данных. Предел 128 MiB удерживает несколько тяжёлых Undo, не допускает неограниченного накопления. Это сознательный консервативный начальный профиль; он не обещает обработку произвольного числа треугольников.

Замеры используют CDP main-page heap/backing storage и отдельный sampler Windows private bytes только процессов тестового браузера, PID которых выдал его CDP connection. Worker/native/browser overhead попадает в sampled private bytes; GPU VRAM не измеряется. Интервал OS sampler 100ms, CDP — не чаще 40ms. Короткие пики могут быть пропущены. performanceCore.memory приложен только как прежняя telemetry и не используется как источник истинного peak или quota.

До byte guards наблюдались sampled peaks примерно **1.15 GB import, 1.80 GB repair, 1.97 GB Undo, 2.13 GB export, 2.76 GB Compare**. Этот baseline обнаружил перекрытие кнопок восьми Lineup карточек и не завершил remove фазу; failure сохранён, не засчитан PASS. После исправления UI и guards отдельный полный цикл прошёл: import **1.13 GB**, repair **1.67 GB**, Undo **1.81 GB**, export **2.00 GB**, Compare **2.66 GB**, Lineup **2.70 GB**. Разница не доказывает снижение RAM: один прогон, GC/семплирование и разные состояния. Цель guards — ограничить admitted данные, не занизить наблюдаемые цифры.

В окончательном production прогоне sampled private peaks: **1194.11 MiB import, 1427.67 MiB repair, 1374.00 MiB Undo, 1597.30 MiB export, 2156.57 MiB Compare, 2114.32 MiB Lineup, 2137.08 MiB remove**. Отдельные пики не означают одновременно занятые memory fields. Harness включает доставку fixture через Playwright, а не native file dialog; переносить цифры на WebView2 нельзя. Немедленное снижение private bytes до исходного уровня не проверялось и не заявляется.

Read-only размеры четырёх предоставленных владельцем GLB: **12 268 308–32 942 388 bytes**, все ниже 64 MiB. Accessor/channel probe показал около **0.55–1.31 MB** клонируемых track streams. Это metadata compatibility check; runtime/deformation/roundtrip именно этих частных моделей в 2.0.9 этим probe не сертифицируются. Частные GLB в комплект не входят.

Два первоначальных запуска profiling harness завершились ошибками: buffer upload Playwright >50MB заменён файлами, затем исправлено перекрытие карточек. Ещё один повтор пересёкся с другим Playwright run и его общим каталогом trace; он не засчитан. Последующие проверки выполняются последовательно с отдельным output directory.

## Проверки

- Unit/integration **330/330 PASS**; TypeScript PASS. RED→GREEN для file/queue/batch-byte admission, packet copying, worker reservation, Heal/Rig refusal и восьми карточек. Отдельные проверки учитывают длинные authored clip names без typed track buffers и безопасную отмену drag при отказе. Export preflight расположен до снимков геометрии/анимаций, а не только перед отправкой packet.
- Native boundary tests: лишние пути и oversized файлы не вызывают readFile, consumer завершается до следующего чтения, capacity проверяется после dialog, ошибка/отмена прекращает дальнейшее чтение.
- Worker tests: общий бюджет, alias accounting, отказ до construction/transfer, освобождение при success/cancel/construction failure. Живые массивы остаются подключены.
- История: отказ не меняет index/rest и не удаляет предыдущий Undo; Rig Undo→Redo после насыщения сохраняет точные состояния.
- Финальная свежая production regression **91/91 PASS**, **202.99 с**, без skipped/flaky/unexpected; 49 приложений доказательств. Source fidelity, rigs, Undo, lifecycle, ownership и новые admission проверки PASS. Repair/Undo/Export/Fitting для 500 001 triangles: long tasks ≥50ms не зарегистрированы, прежний gate ≤100ms сохранён.
- Windows release/NSIS PASS. EXE ProductVersion/FileVersion **2.0.9**, **11 384 832 bytes**, SHA256 `D37C8FB4C583D30EB6F3E0B3483E1A546363FBF34C55D97BC31E35B45D38DBD3`. NSIS SHA256 `52A9CB3CBA27EA927AF9079A1DFFDB5C88C256714A50D1EC61EAF74366E2428D`. Native EXE не запускался, installer не применялся.

## Границы и приёмка

Это **не** process-wide RAM cap: topology maps/sets, V8 GC, image decoding, decoded textures и driver/GPU allocations имеют собственную стоимость. Маленький compressed GLB может декодироваться значительно больше исходника до packRoot. Native файл может измениться между stat/readFile; повторная проверка не отменяет уже выполненное чтение. Universal OOM prevention, adaptive device budgets и native WebView2 peak/VRAM certification не заявляются.

В узком Compare окно общей toolbar переносится в две строки; эта прежняя компоновка не перерабатывалась. Новый regression проверяет доступность отдельных кнопок карточек и удаление всех восьми моделей; снимок приложен. Полное переустройство Compare toolbar не является F07.

Нужна повторная Windows приёмка 2.0.10: оба набора из замечания, переполненный выбор Compare, отказ слишком большого файла с сохранением текущей модели, импорт/Lineup/remove восьми моделей, Undo/Redo и строгий Verify/Save. Последующие F08 orchestration/accurate telemetry и F09 profile selector остаются отдельными работами.
