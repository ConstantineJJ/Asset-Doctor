# F05 — Runtime Metadata: QA

2026-10-13. База: принятые F01 `57d1994`, Native Confirm `67700db`, F03 `af7537e`.
Область: Windows/Tauri Desktop. F02/F08 не начаты; push не выполняется.

## Исправление и доказательства

**P1 / F05:** SourceAudit и снимки Material хранились в сериализуемом `userData`.
Две регрессии на принятой базе воспроизвели загрязнение экспортированного GLB:
`$.nodes.0.extras.__assetDoctorSourceAudit` и
`$.nodes.2.extras.__assetDoctorAuthoredMaterials` (`red.log`, traces/screenshots).
Снимки материала могли включать повторное представление изображения в data URI.
JSON-копирование `userData` при клонировании также теряло реальные Material instances.

Теперь SourceAudit и авторские снимки Material хранятся в WeakMap с ключами root/mesh.
Они не сериализуются; после освобождения ключей записи доступны сборщику мусора.
Legacy import удаляет только три известных служебных поля, включая старый
`__assetDoctorCompareGrounded`. Произвольные авторские ключи с похожим префиксом
(проверен `__assetDoctorUserNote`) сохраняются.

В установленном GLTFExporter document extras и texture extras по умолчанию не
экспортируются. Узкий plugin сохраняет их из сырого исходного документа через
WeakMap root/Texture. Это авторские данные, а не runtime snapshot. Сохраняются
также допустимые glTF значения extras: массивы, строки, числа, false, null, {}.
Scene/node/material extras проходят существующий путь экспорта. Принятые
ограничения F01 и его проверка геометрии, материалов, rig и animation не ослаблены.

Compare Lineup получает SkeletonUtils-клон с явной передачей авторских Material
и SourceAudit. Материалы, bones и skeleton принадлежат клону; geometry/Texture
заимствуются из источника и не освобождаются при удалении клона. UUID-треки
перепривязываются к клону без изменения исходных clips. Авторские extras остаются.
Обнаруженный связанный дефект: опорная анимация и выбор clip в Lineup искались
только в Grid. Исправлен выбор текущего Lineup action и сохранение clip selection.
F03 wrapper продолжает владеть только viewer-размещением, масштабом и вращением.

## Результаты

| Проверка | Результат / доказательство |
| --- | --- |
| TypeScript | PASS; `lint-final.log` |
| Unit/integration | PASS, 145/145; `unit-final.log`, 7 новых F05 проверок |
| Production frontend regression | PASS, 21/21; `browser-final.log`, включая F01/F03 и Confirm/Cancel/Dialog Error |
| Import → Repair → Undo → Repair → Export → Reimport | PASS на чистом и legacy textured skin; пользовательские extras, 3 → 2 → 3 → 2 tri |
| GLB JSON | PASS: известных внутренних полей нет, data:image в JSON нет, одно изображение; document/scene/node/material/texture author extras сохранены |
| Материалы и текстура | PASS: реальные PBR Material, цвет/alpha/roughness/metalness, sampler/colorSpace/flipY и все 16 RGBA значений 2×2 PNG после reimport |
| Skin/animation | PASS: joints, indices, weights, inverse bind matrices и живая анимация; UUID-binding проверен unit-тестом |
| Compare | PASS: Grid ↔ Lineup, Unlit/Flat → Base Color/Smooth → PBR/Hybrid, выбор clip, playback, удаление модели, Doctor handoff; собственные Materials/skeleton и живые заимствованные ресурсы |
| Диагностика | PASS: raw source weight defects и failed resource findings сохраняются на root и clone |
| Tauri check/build | PASS: Windows x64 EXE и NSIS; `desktop-check.log`, `desktop-build.log` |
| Windows release runtime | PASS: Confirm/Cancel, Undo, настоящий Save → Reimport, все материал/texture/skin/extras проверки; `native-*.json/png/log`, `native-repaired.glb` |
| Native Compare | PASS: реальные Lineup clones, playback, AlternateMotion, render/shading mode switches, removal и Doctor handoff; `native-compare.json`, `native-compare-lineup.png` |

Browser tests проверяют frontend desktop-приложения, веб-продукт не развивается.
Изменены только хранение/передача metadata, узкий exporter plugin и связанные
Compare bindings. Зависимости, версия продукта, Native Confirm ACL и исходные
F01/F03 fixtures не изменены. Изображения остаются в штатных GLB image bufferViews;
пользовательские extras не подвергаются общему удалению URI/префиксов.

Native QA: release EXE, отдельный WebView2-профиль, WebView2 `155.0.4283.45`,
живой WebView2 через CDP и read-only React probe. Confirm/Cancel/Save нажаты
через Windows UI automation; import использует встроенный file input.
В первом подключении с default overrides после отключения CDP потерян WebView;
его данные не засчитаны. Все сценарии повторены с `noDefaults: true`.
Дополнительный disconnect probe подтвердил HTTP 200 и рабочее native окно после
`browser.close` с этим режимом; причина первого сбоя инструмента не установлена.

**WARN:** прежнее предупреждение Vite о размере bundle; F02 performance budget
не закрывается этим этапом. Сценарии используют синтетический rig с одним joint,
одним clip при roundtrip и двумя clips в Compare. Это не сертификация всех rigs.
**SKIP:** clean-machine установка/удаление NSIS, другие GPU/DPI и native Open.
NSIS не подписан; версия `0.0.0` сохранена от принятой базы.

## Ручная приёмка

1. Запустить EXE и открыть приложенный `metadata-source.glb`: авторский checker,
   прозрачность и JointMotion должны работать. Safe Queue: Cancel оставляет 3 tri;
   Confirm даёт 2; Undo возвращает 3. Повторить ремонт.
2. Build & Verify → Save → открыть сохранённый GLB: 2 tri, те же материалы/пиксели,
   extras и работающий skin/clip. Приложенный `native-repaired.glb` — контрольный экспорт.
3. Compare: добавить source и `metadata-compare.glb`, переключить Grid/Lineup,
   PBR/Unlit/Base Color и Hybrid/Flat/Smooth; проверить playback, AlternateMotion,
   удалить одну модель и вернуться в Doctor. Остальная модель должна сохранить текстуру.
4. Повторить roundtrip на своём GLB с авторскими extras, текстурами и реальным rig;
   проверить исходные Health-находки и viewer rotation/Frame/Rescan из F03.

F05 ожидает ручной приёмки владельцем. Следующий этап не начинается.
