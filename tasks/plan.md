# F08 и дополнительные инструменты — 15.10.2026

База: принятая владельцем 2.0.10 (`4f13e50`), F07 закрыт по ручной приёмке. Работа продолжается в существующей ветке, без изменения принятых verdict/export/Undo guards. Настольные окна и installer автоматически не запускаются.

1. **F08: явные зависимости и владельцы состояния.** Заменить prototype instrumentation на инъекцию MetricsSink в Heal/Export и явный публичный snapshot памяти; считать уникальные backing buffers, включая interleaved/morph/shared геометрию Mesh/Line/Points. Удалить удерживаемые ссылки на уже освобождённые export verification данные из текущих memory counters, отделить измеренные transient значения. Вынести revision/stale-result authority в AssetSession и ExportCoordinator; фактически использовать их в App. Проверки: независимые sink instances, отсутствие глобального patching, stale/cancel/save races и существующие fidelity/performance gates.
2. **Тайлы пола.** Прочитать только PNG entries из Tiles.zip, проверить разрешения/хеши. Единый каталог для Doctor, Compare и настроек поверхностей. Семантические дубликаты grass/road/sand заменить новыми изображениями, остальные добавить вариантами. Обеспечить отмену устаревшей загрузки и освобождение texture ресурсов, offline загрузку и совпадение хешей с архивом.
3. **Горячие клавиши.** Сохраняемая локально таблица назначений в настройках: существующие frame/play/wireframe/undo плюс redo, open, helpers, logs. Запись сочетания, отключение, восстановление defaults, видимая проверка конфликтов. Общие правила input/modal/repeat/composition; клавиши действуют только на активный viewport, текстовый Undo сохраняется. Не оставлять два Space handlers.
4. **Системный журнал.** Структурированный ограниченный журнал с session/operation IDs, временем, уровнем, стадией и ошибкой. Переключатель записи, просмотр/сохранение/очистка через значок справа вверху. Native bounded rotating file; browser test fallback. Явные события import/analysis/worker/repair/export/cancel и глобальные ошибки без monkeypatch console. Вопросы: какая операция и модель, где началась/закончилась, почему отказ/отмена, совпадает ли результат с актуальной сессией. Логи не содержат binary payloads, raw geometry или полных model paths.
5. **Диагностические отчёты.** Свиток рядом с Focus на карточке. Снимок результатов текущего сканирования: модель/версия/стадии, конкретное местоположение, severity/evidence/action/manual status. Общая команда в нижней системной полосе сохраняет все текущие неисправности, независимо от выбранной страницы/фильтра. Отдельные и общие отчёты отделены от системного лога. Черновой/неполный scan явно помечается; новая модель не получает старый отчёт.
6. **Проверка и поставка.** Проверять каждый increment и фиксировать отдельным commit. Затем TypeScript, полный unit/browser regression, headless visual evidence на нескольких размерах, Windows/NSIS build, новая неизменяемая поставка. Результаты native ручной приёмки не подменяются headless проверками. F09 остаётся отдельным пунктом.

Приоритет — сохранить существующие source fidelity, cancellation, resource ownership и ≤100 ms gates. Не расширять рефакторинг на весь App, не переустраивать существующие инструменты редактирования.

## F09 — диагностический профиль / 2.0.13

Приёмка 2.0.12 принята владельцем 15 октября: функции штатны. В новых журналах нет новых ошибок приложения; 66 tiny index components — ручное замечание модели, не регрессия программы.

1. Дать семь существующих профилей через доступный RU/EN selector в Inspector, показать активный профиль и переход к оценке пригодности.
2. Пересчитывать только Fitness из сохранённых метрик. Технические findings, UNKNOWN от неудачного worker, scan revision, source и история сохраняются. Незавершённая topology использует последний выбранный профиль при завершении.
3. Проверить General/Mobile и все профили, single/bulk diagnostic report, in-flight/error paths, compact/4K UI. Затем полный fresh production regression, unit/native gates, Windows/NSIS build и отдельная поставка. Desktop EXE/installer автоматически не запускать.

## Общее ревью после F09 / 2.0.14

По дополнительному поручению владельца после завершения поставки 2.0.13 проверить подсистемы программы и исправить подтверждённые дефекты. Проведён проход App/session/import, анализ/rig/animation, Heal/exports, workers/memory/resources, UI/settings/logs и native/build/security. В отдельные commits вынесены исправления CUBICSPLINE-диагностики, viewport framing/bounds/drag, worker envelope/export freshness и обязательного Rust formatting gate. RED/green доказательства и границы проверки — в PROGRAM_REVIEW_2_0_14.md. Финальная поставка включает F09; ручная приёмка остаётся открытой.
