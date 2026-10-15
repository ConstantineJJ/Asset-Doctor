# F08 — ход работы

- [x] Явный MetricsSink, память и AssetSession/ExportCoordinator; 339 unit/integration и 9 production browser PASS.
- [x] Tiles.zip: 11 исходных PNG, единый каталог и замены, shared texture leases; focused lifecycle/offline проверки PASS. Visual capture войдёт в final production regression.
- [x] Назначаемые горячие клавиши, persistence/conflicts/modal safety; 344 unit и focused browser PASS. Команды журналов подключаются вместе с самими журналами.
- [x] Системный журнал, rotating native storage, верхний значок; bounded queue и восстановление оборванной строки.
- [x] Диагностические отчёты, свиток карточки, нижняя системная полоса; native cancel/stale/write guards.
- [x] Полная production проверка 99/99, owner corpus 2/2, unit 363/363, native 4/4, Windows EXE/NSIS build, QA и отдельная поставка 2.0.11 для приёмки. F09 не включён.

## Замечание приёмки: история поворотов / 2.0.12

- [x] Прочитать присланные logs/JSON, сохранить evidence и отделить YellowCar findings от отказа истории рига.
- [x] RED на том же owner GLB (20-я ротация) и синтетической dense animation.
- [x] Copy-on-write streams, малые signatures и точная animation equality, прежний limit 128 MiB, pre/post budget guards.
- [x] Явное logging manual/Gizmo errors с контекстом, атомарный отказ Apply и настоящего drag при fault injection.
- [x] Финальные gates: unit 364/364, production 101/101, owner 1/1, log visual 1/1, native 4/4; Windows build, QA и отдельный комплект 2.0.12. F09 не включён.
- [x] Владелец принял 2.0.12: функции работают штатно; F08 и замечание о поворотах закрыты.

## F09 — профили диагностики / 2.0.13

- [x] RU/EN selector семи профилей, видимый активный профиль, переход к оценке пригодности.
- [x] Только cached Fitness; технические findings и UNKNOWN сохраняются без повторного Health/topology.
- [x] Single/bulk report с текущим профилем; обработка смены профиля во время topology.
- [ ] Полный production regression, visual QA compact/4K, native gates и новая поставка для ручной приёмки.
