# Ревью и подготовка Asset Doctor к Tauri

Дата: 2026-10-05. Основа: `main`, commit `4db6f99`.

Проверен актуальный Asset-Doctor. Прежний аудит другого состояния исходников
использован как список сценариев для повторной проверки, а не как доказательство
ошибок в текущей версии. Изменения предназначены для проверки через pull request.

## Исправленные проблемы

| Приоритет | Ошибка | Исправление и доказательство |
|---|---|---|
| P1 | Внешние ресурсы в GLB и переименованном glTF обходили проверку single-file import; HTTPS и `file://` достигали fetch | Проверка содержимого в общем импорте ArrayBuffer. Регрессии используют настоящие сериализованные GLB/glTF; до исправления тесты воспроизводили обращения к fetch |
| P1 | Успешный callback загрузчика принимал частичную модель после ошибок ресурсов | Ошибки LoadingManager приводят к отказу импорта; ресурсы неполной сцены освобождаются |
| P1 | Build & Verify снимал предупреждение о несохранённом ремонте до записи копии | Сохранённое состояние отдельно от VERIFIED. Browser regression воспроизвёл проблему до исправления |
| P1 | Ремонт, сделанный во время следующего импорта, стирался при его завершении | Повторная проверка версии ремонта перед сменой модели. Browser regression: задержанный импорт, repair queue, подтверждение, Cancel |
| P2 | Pending import мог заменить более поздний выбранный sample; native picker мог использовать устаревшее состояние unsaved | Версия запросов, проверка актуального состояния после await, освобождение устаревших результатов |
| P2 | Скачивание в браузере считалось сохранённым даже при отказе download | Browser handoff сохраняет защиту; desktop снимает её только после завершения writeFile |
| P2 | Обычный npm install не проходил из-за прямого esbuild 0.25 при Vite 8 | Убрана неиспользуемая прямая зависимость; воспроизводимая установка через npm ci и package-lock |
| P2 | После desktop build TypeScript сканировал бинарные codegen-файлы внутри src-tauri/target | Область TypeScript ограничена исходниками, скриптами и тестами |
| P2 | PNG приложения повреждён и не принимается генератором Tauri icons | Добавлен исходный SVG и сгенерированы desktop icons; favicon и toolbar используют SVG |

## Что добавлено для Tauri

- Tauri 2 Rust shell, native dialog/fs plugins, Windows NSIS build.
- Нативные Open в Doctor/Compare и Save repaired copy; отмена и ошибки записи
  не стирают ремонтную сессию. Тесты покрывают ожидание записи и Unicode-имена.
- Проверка current request перед публикацией async экспорта и блокировка
  повторных save/export до завершения текущей операции.
- Предупреждение при закрытии окна с несохранённым ремонтом.
- CSP для локальных workers/WASM/blob/data. У файловых capabilities нет
  глобального доступа ко всему диску; диалог выдаёт scope выбранному пути.
- HTML5 drag-and-drop: `dragDropEnabled: false`.
- Windows-compatible cleanup, npm scripts, Windows build в CI.

Решения сверены с документацией Tauri:
[Vite](https://v2.tauri.app/start/frontend/vite/),
[dialog](https://v2.tauri.app/plugin/dialog/),
[filesystem](https://v2.tauri.app/plugin/file-system/),
[CSP](https://v2.tauri.app/security/csp/),
[drag-and-drop configuration](https://v2.tauri.app/reference/config/#dragdropenabled).

## Проверки

| Проверка | Результат |
|---|---|
| Чистая установка npm ci по lockfile | PASS |
| TypeScript | PASS |
| Unit/integration tests | PASS: 123/123 |
| Browser: verified/export protection, stale import, 8-asset Compare, repair during import и offline Draco | PASS: 5/5, production bundle |
| Production: Draco без внешней сети и с desktop CSP, workers/WASM | PASS; реальный сериализованный Khronos Box fixture |
| Production bundle | PASS; предупреждение о размере основного JS chunk сохраняется |
| Rust cargo check и formatting | PASS |
| Windows release executable и NSIS installer | PASS |
| npm audit | PASS: 0 известных уязвимостей в установленном дереве |

Файлы установки имеют версию проекта `0.0.0`, не подписаны и не опубликованы
как production release. Текущий Windows runtime уже содержит WebView2.

Собранный `Asset Doctor_0.0.0_x64-setup.exe`: 3 104 355 байт.
SHA256: `1B6F9BC863BBEB4F5DB28268A3B454830AAE31ECAA1E1A29FD88C771CB9F795A`.

## Оставшаяся приёмка

**SKIP:** установка/удаление на чистой Windows, взаимодействие с настоящими
native dialogs и закрытием WebView2, разные GPU/DPI, длительный heavy-model
soak, реальные Meshopt/KTX2 fixtures и расширенная проверка анимаций/деформаций.
Нативные файловые сценарии проверены на IPC boundary; это не заменяет ручную
приёмку desktop runtime. Сертификат подписи и политика обновлений ещё не заданы.

**WARN:** размер основного JS chunk; тяжелые синхронные Heal/export проходы
сохраняют ограничения, описанные в прежней performance acceptance matrix.
Подготовленная упаковка Tauri не служит доказательством прохождения этих проверок.

Self-contained import остаётся осознанным контрактом. Поддержка комплектов
`.gltf + .bin + изображения` потребует отдельного resolver и проверки границ
доступа, а не выдачи приложению разрешения читать весь диск.
