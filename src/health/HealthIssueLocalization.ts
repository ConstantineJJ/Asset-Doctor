import type {
  DiagnosticLayer,
  HealthCategory,
  HealthIssue,
  HealthSeverity,
  Repairability,
} from '../types';
import type { AppLanguage } from '../i18n';

type LocalizedFields = Partial<Pick<
  HealthIssue,
  'title' | 'description' | 'evidence' | 'whyItMatters' | 'suggestedAction' | 'technicalDetails'
>>;

type Translator = (issue: HealthIssue) => LocalizedFields;

const count = (issue: HealthIssue) => issue.count ?? 0;
const evidenceSample = (issue: HealthIssue) => issue.evidence ? `Образцы / технические данные: ${issue.evidence}` : undefined;

const RU: Record<string, Translator> = {
  'integrity-core-readable': () => ({
    title: 'Основные данные сцены структурно корректны',
    description: 'Иерархия сцены, количество meshes и данные bounding box успешно разобраны и содержат конечные числовые значения.',
    whyItMatters: 'Это создаёт надёжную основу для более глубоких проверок Health и Fitness.',
    suggestedAction: 'Действия не требуются.',
  }),
  'integrity-core-numeric-invalid': () => ({
    title: 'Некорректные основные данные ассета',
    description: 'Одна или несколько метрик сцены или геометрии содержат отрицательные, NaN, Infinity либо иные недопустимые значения.',
    whyItMatters: 'На таких данных нельзя надёжно строить дальнейшую диагностику и автоматические repair-операции.',
    suggestedAction: 'Исправьте или повторно экспортируйте исходный ассет до применения автоматических исправлений.',
  }),
  'integrity-missing-position': (i) => ({
    title: 'В mesh отсутствуют данные POSITION',
    description: `${count(i)} mesh не содержат пригодного атрибута позиций вершин.`,
    evidence: `Meshes без POSITION: ${count(i)}.`,
    whyItMatters: 'Корректные позиции вершин необходимы для отображения, bounds, topology и экспорта.',
    suggestedAction: 'Исправьте или повторно экспортируйте исходную геометрию.',
  }),
  'integrity-invalid-indices': (i) => ({
    title: 'Обнаружены некорректные индексы геометрии',
    description: `Обнаружено ${count(i)} проблем с index buffer: выход за диапазон, нецелые значения либо некорректная длина треугольного index buffer.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Некорректные индексы могут ссылаться на отсутствующие вершины, ломать треугольники и делать ремонт или экспорт недетерминированным.',
    suggestedAction: 'Проверьте исходный mesh и исправьте index buffer в DCC или повторным экспортом.',
  }),
  'integrity-nonfinite-positions': (i) => ({
    title: 'В позициях вершин обнаружены NaN / Infinity',
    description: `Обнаружено ${count(i)} нечисловых или бесконечных компонентов POSITION.`,
    whyItMatters: 'NaN и Infinity могут испортить bounds, transforms, rendering, topology и export.',
    suggestedAction: 'Исправьте исходную геометрию; Asset Doctor не будет угадывать координаты.',
  }),
  'integrity-nonfinite-attributes': (i) => ({
    title: 'В атрибутах геометрии обнаружены NaN / Infinity',
    description: `В vertex/morph attributes вне POSITION обнаружено ${count(i)} некорректных числовых компонентов.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Некорректные normals, UV, colors, morph или skin data могут давать неопределённый результат отображения и деформации.',
    suggestedAction: 'Явно исправьте соответствующий атрибут в исходном ассете.',
  }),
  'integrity-malformed-attribute-counts': (i) => ({
    title: 'Некорректное количество vertex-domain attributes',
    description: `Обнаружено ${count(i)} несоответствий размеров базовых или morph attributes относительно vertex domain.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Vertex-domain attributes должны однозначно соответствовать описываемой геометрии.',
    suggestedAction: 'Повторно экспортируйте либо вручную исправьте атрибуты mesh.',
  }),
  'integrity-incomplete-skin-attributes': (i) => ({
    title: 'Неполная пара skin attributes',
    description: `${count(i)} SkinnedMesh содержат skinIndex без skinWeight либо skinWeight без skinIndex.`,
    whyItMatters: 'Skin indices и weights образуют связанную пару данных для skeletal deformation.',
    suggestedAction: 'Восстановите отсутствующий skin attribute в исходном rig/export.',
  }),
  'integrity-invalid-skin-indices': (i) => ({
    title: 'Обнаружены некорректные skin indices',
    description: `${count(i)} значений skinIndex ссылаются на bone за пределами связанного skeleton.`,
    whyItMatters: 'Bone references вне диапазона делают skeletal deformation неопределённой.',
    suggestedAction: 'Исправьте skin indices и weights в исходном rig; не переназначайте bones наугад.',
  }),
  'integrity-broken-skeleton-references': (i) => ({
    title: 'Обнаружены повреждённые ссылки skeleton',
    description: `Найдено ${count(i)} несоответствий в связях skeleton / bone inverse data.`,
    evidence: evidenceSample(i),
    whyItMatters: 'SkinnedMesh должен ссылаться на согласованный skeleton с соответствующими inverse bind matrices.',
    suggestedAction: 'Исправьте или заново привяжите skeleton в DCC до работы с weights.',
  }),
  'integrity-geometry-buffers-ok': () => ({
    title: 'Geometry buffers прошли проверку целостности',
    description: 'Indices, vertex-domain attributes, morph attributes и доступные skin references структурно согласованы.',
    whyItMatters: 'Детерминированная диагностика и repair могут опираться на разобранные buffers.',
    suggestedAction: 'Действия не требуются.',
  }),

  'topo-degenerate-triangles': (i) => ({
    title: `Дегенеративные треугольники: ${count(i)}`,
    description: `${count(i)} треугольников имеют коллинеарные либо нулевые рёбра и почти нулевую площадь. Это может вызывать нестабильный shading, baking и проблемы последующей обработки.`,
    technicalDetails: 'Площадь треугольника находится на уровне или ниже детерминированного epsilon.',
    suggestedAction: 'Сначала выполните Preview. Любое автоматическое удаление должно пройти повторную проверку.',
  }),
  'topo-degenerate-ok': () => ({
    title: 'Дегенеративные треугольники не обнаружены',
    description: 'Все проверенные треугольники имеют корректную ненулевую площадь.',
  }),
  'topo-non-manifold-edges': (i) => ({
    title: `Non-manifold index edges: ${count(i)}`,
    description: `${count(i)} индексных рёбер используются более чем двумя faces. Это вывод по index connectivity, а не автоматическое доказательство повреждённой поверхности.`,
    technicalDetails: 'Одно индексное ребро связано более чем с двумя треугольниками.',
    suggestedAction: 'Рекомендуется ручная проверка edge fan и предполагаемой связности поверхности.',
  }),
  'topo-non-manifold-ok': () => ({
    title: 'Non-manifold index edges не обнаружены',
    description: 'Не найдено индексных рёбер, принадлежащих более чем двум faces.',
  }),
  'topo-boundary-edges': (i) => ({
    title: `Граничные index edges: ${count(i)}`,
    description: `${count(i)} рёбер принадлежат только одному треугольнику в индексном графе. Это не доказывает наличие геометрической дыры: glTF часто разделяет vertices на UV seams, material splits и hard-normal boundaries.`,
    technicalDetails: 'Рёбра с одним инцидентным треугольником в index connectivity; пространственно совпадающие seam vertices могут оставаться раздельными.',
    suggestedAction: 'Проверяйте реальную поверхность только если требуется watertight geometry. Не сваривайте attribute seams лишь ради уменьшения счётчика.',
  }),
  'topo-watertight-ok': () => ({
    title: 'Граничные index edges не обнаружены',
    description: 'В index connectivity не найдено рёбер, принадлежащих только одному треугольнику.',
  }),
  'topo-isolated-vertices': (i) => ({
    title: `Unreferenced vertices: ${count(i)}`,
    description: `${count(i)} позиций vertices присутствуют в buffer, но не используются ни одним indexed face.`,
    technicalDetails: 'Неиспользуемые позиции в indexed vertex buffer.',
    suggestedAction: 'Выполните Preview удаления unreferenced vertices и проверьте сохранность всех vertex-domain attributes.',
  }),
  'topo-tiny-components': (i) => ({
    title: `Мелкие index-connected components: ${count(i)}`,
    description: `Найдено ${count(i)} маленьких components в index connectivity. Attribute seams могут разделять визуально непрерывную поверхность, поэтому это не обязательно мусорная геометрия.`,
    suggestedAction: 'Ручная проверка: убедитесь, что component действительно отделён и нежелателен, прежде чем удалять или объединять его.',
  }),
  'topo-thin-triangles': (i) => ({
    title: `Игольчатые треугольники: ${count(i)}`,
    description: `${count(i)} треугольников имеют экстремальное соотношение сторон (>35:1). Они могут усиливать shading shimmer или делать baking хрупким.`,
    suggestedAction: 'Исправляйте вручную только если эти faces действительно вызывают визуальные или deformation/baking проблемы.',
  }),
  'topo-duplicate-positions': (i) => ({
    title: `Совпадающие позиции vertices: ${count(i)}`,
    description: `${count(i)} vertices попадают в почти одинаковые пространственные позиции. В real-time meshes это может быть намеренно из-за UV seams и hard normals.`,
    suggestedAction: 'Preview exact-duplicate merge. Объединять можно только vertices с полностью совпадающими vertex/morph attributes.',
  }),
  'topo-exact-duplicate-triangles': (i) => ({
    title: `Точные duplicate triangles: ${count(i)}`,
    description: `${count(i)} indexed triangles повторяют более ранний треугольник с теми же vertex indices и winding. Обратные backfaces не учитываются.`,
    evidence: 'Учитываются только cyclic duplicates с одинаковым winding.',
    whyItMatters: 'Точные duplicate faces создают лишнюю rasterization и могут давать depth/shading ambiguity.',
    suggestedAction: 'Preview удаления. Автооперация разрешается только после material, draw-range, sharing и topology safety gates.',
  }),
  'topology-analysis-unknown': (i) => ({
    title: 'Topology analysis недоступен',
    description: 'Фоновый проход topology не завершился, поэтому состояние topology нельзя определить надёжно.',
    evidence: evidenceSample(i),
    whyItMatters: 'Без topology measurements нельзя безопасно подтверждать часть repair-операций.',
    suggestedAction: 'Повторите Rescan. Если ошибка повторяется, проверьте ассет или Worker pipeline.',
  }),

  'normals-missing': (i) => ({
    title: 'Отсутствуют vertex normals',
    description: `${count(i)} mesh не содержат явных normal vectors; shading будет зависеть от runtime-generated или fallback normals.`,
    evidence: `Meshes без normal attributes: ${count(i)}.`,
    suggestedAction: 'Выполните Preview детерминированного пересчёта Normals для затронутого mesh.',
  }),
  'normals-ok': () => ({
    title: 'Vertex normals в порядке',
    description: 'Все meshes содержат явные vertex normal attributes.',
  }),
  'normals-zero': (i) => ({
    title: 'Обнаружены некорректные normal vectors',
    description: `${count(i)} vertex normals имеют нулевую длину, NaN/Infinity, некорректную структуру либо существенно не нормализованы.`,
    evidence: `Некорректных normal vectors: ${count(i)}.`,
    suggestedAction: 'Выполните Preview детерминированного пересчёта Normals.',
  }),
  'uv-missing-uv0': (i) => ({
    title: 'Meshes без основного UV0',
    description: `${count(i)} mesh не имеют UV0. Текстуры, которым требуется UV0, не смогут нормально семплироваться.`,
    suggestedAction: 'Ручная UV-развёртка нужна только если UV mapping требуется выбранному material workflow.',
  }),
  'uv0-ok': () => ({
    title: 'Основной UV set (UV0) присутствует',
    description: 'Все meshes имеют основные texture coordinates.',
  }),
  'uv-secondary-uv1': (i) => ({
    title: 'Обнаружен дополнительный UV set (UV1 / Lightmap)',
    description: `${count(i)} mesh содержат дополнительные UV channels, пригодные для baked lighting или detail texturing.`,
  }),
  'uv-channel-inventory': (i) => ({
    title: 'Инвентаризация UV channels',
    description: `Обнаружено UV channels: ${count(i)}.`,
    evidence: evidenceSample(i),
    suggestedAction: 'Действия не требуются; используйте список для проверки ожидаемых channels.',
  }),
  'uv-malformed-attributes': (i) => ({
    title: 'Некорректный размер UV attributes',
    description: `${count(i)} mesh имеют UV0 item size/count, не соответствующий vertex domain.`,
    evidence: 'UV0 должен содержать минимум два компонента на vertex и совпадать по count с POSITION.',
    whyItMatters: 'Некорректные UV arrays нельзя детерминированно сопоставить vertices.',
    suggestedAction: 'Исправьте или повторно экспортируйте UV attribute в DCC.',
  }),
  'uv-nonfinite-values': (i) => ({
    title: 'В UV coordinates обнаружены NaN / Infinity',
    description: `${count(i)} UV vertices содержат нечисловые или бесконечные U/V значения.`,
    whyItMatters: 'Non-finite UV могут давать неопределённый texture sampling и ломать UV diagnostics.',
    suggestedAction: 'Явно исправьте UV data в исходном ассете.',
  }),
  'uv-zero-area-triangles': (i) => ({
    title: 'Обнаружены UV-треугольники нулевой площади',
    description: `${count(i)} треугольников схлопываются до нулевой или почти нулевой площади в UV0.`,
    whyItMatters: 'Схлопнутые UV faces могут нарушать baking, mip behavior и texture-space derivatives.',
    suggestedAction: 'Проверьте faces вручную и исправляйте только если схлопывание не является намеренным.',
  }),
  'uv-outside-unit-range': (i) => ({
    title: 'UV coordinates выходят за диапазон 0–1',
    description: `${count(i)} UV vertices находятся вне tile 0–1. Это информационная находка: tiled и UDIM-like workflows могут использовать такие координаты намеренно.`,
    suggestedAction: 'Действия не требуются, если выход за 0–1 соответствует intended material workflow.',
  }),

  'skin-static-ok': () => ({
    title: 'Rig-specific проверки неприменимы',
    description: 'Ассет не содержит skeletal armature или SkinnedMesh, поэтому skinning diagnostics не применяются.',
    evidence: 'Skeleton / SkinnedMesh не обнаружены.',
    whyItMatters: 'Отсутствие rig не является дефектом для статического ассета.',
    suggestedAction: 'Действия не требуются, если rig не ожидался.',
  }),
  'skin-rig-detected': (i) => ({
    title: `Skeletal rig проверен: ${count(i)} bones`,
    description: 'Rig и связанные SkinnedMesh успешно обнаружены и доступны для диагностики.',
  }),
  'skin-max-influences': (i) => ({
    title: `Максимум bone influences: ${count(i)}`,
    description: `Некоторые vertices используют до ${count(i)} активных bone weights, что превышает reference threshold выбранного профиля.`,
    suggestedAction: 'Проверьте требования целевого runtime прежде чем сокращать influences.',
  }),
  'skin-influences-ok': (i) => ({
    title: `Bone influences соответствуют профилю: ${count(i) || 'OK'}`,
    description: 'Количество активных bone influences находится в пределах reference threshold.',
  }),
  'skin-zero-weight': (i) => ({
    title: `Vertices без skin weight: ${count(i)}`,
    description: `${count(i)} vertices имеют нулевое суммарное влияние bones и могут оставаться в bind pose при анимации.`,
    suggestedAction: 'Исправьте weights вручную; Asset Doctor не угадывает подходящий bone.',
  }),
  'skin-invalid-sum': (i) => ({
    title: `Ненормализованные bone weights: ${count(i)}`,
    description: `${count(i)} vertices имеют сумму weights, отличающуюся от 1.0 сверх допуска.`,
    evidence: evidenceSample(i),
    suggestedAction: 'Preview нормализации ненулевых Skin Weights. Zero-weight vertices автоматически не назначаются.',
  }),
  'skin-redundant-influences': (i) => ({
    title: `Повторные skin influences: ${count(i)}`,
    description: `${count(i)} vertices содержат один и тот же активный bone index более чем в одном influence slot.`,
    evidence: 'Несколько ненулевых slots ссылаются на один bone.',
    whyItMatters: 'Duplicate slots расходуют influence capacity и усложняют инспекцию skin data.',
    suggestedAction: 'Preview consolidation: duplicate weights суммируются в один slot без угадывания новых influences.',
  }),
  'skin-unused-bones': (i) => ({
    title: `Неиспользуемые bones: ${count(i)}`,
    description: `${count(i)} bones skeleton не участвуют ни в одном vertex weight. Это могут быть attachment sockets или locator nodes.`,
    suggestedAction: 'Не удаляйте автоматически. Сначала выясните назначение bones.',
  }),

  'mat-none': () => ({
    title: 'Материалы не назначены',
    description: 'Meshes используют fallback/default shading вместо явно определённых materials.',
    suggestedAction: 'Проверьте, ожидались ли материалы в исходном ассете.',
  }),
  'mat-count-ok': (i) => ({
    title: `Определено материалов: ${count(i)}`,
    description: `Загружено ${count(i)} уникальных PBR material instances.`,
  }),
  'mat-double-sided': (i) => ({
    title: `Double-sided materials: ${count(i)}`,
    description: `${count(i)} материалов отключают backface culling. Это может увеличить rasterization cost.`,
  }),
  'mat-alpha-blend': (i) => ({
    title: `Alpha-blend materials: ${count(i)}`,
    description: `${count(i)} материалов используют alpha blending и требуют сортировки transparent fragments.`,
  }),

  'tex-invalid-dimensions': (i) => ({
    title: `Некорректные или недоступные текстуры: ${count(i)}`,
    description: `${count(i)} texture resources имеют отсутствующие, неразрешённые либо некорректные размеры.`,
    suggestedAction: 'Восстановите отсутствующий image/resource или исправьте source package.',
  }),
  'tex-metadata-readable': (i) => ({
    title: 'Метаданные текстур читаются корректно',
    description: `Все ${count(i)} обнаруженных textures имеют корректные dimensions.`,
    suggestedAction: 'Действия не требуются.',
  }),
  'tex-none': () => ({
    title: 'Текстуры не обнаружены',
    description: 'В загруженном ассете не обнаружены texture images.',
  }),
  'tex-npot': (i) => ({
    title: `Non-power-of-two textures: ${count(i)}`,
    description: `${count(i)} textures имеют размеры не степени двойки. В современном WebGL2 это обычно допустимо и является информационной находкой.`,
  }),

  'animation-invalid-targets': (i) => ({
    title: 'Animation tracks ссылаются на отсутствующие nodes',
    description: `${count(i)} animation tracks не удалось сопоставить node или bone в загруженной сцене.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Track без корректной цели не может управлять предполагаемым transform/property.',
    suggestedAction: 'Восстановите target либо удалите/retarget track в animation authoring tool.',
  }),
  'animation-malformed-tracks': (i) => ({
    title: 'Обнаружены некорректные animation tracks',
    description: `${count(i)} tracks имеют пустые данные либо несовместимую форму key/value arrays.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Некорректные keyframe tracks нельзя надёжно проигрывать или редактировать.',
    suggestedAction: 'Исправьте или повторно экспортируйте clips до применения animation patches.',
  }),
  'animation-nonfinite-keys': (i) => ({
    title: 'В animation keys обнаружены NaN / Infinity',
    description: `Обнаружено ${count(i)} нечисловых timestamps или value components.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Non-finite animation data могут испортить interpolation, playback и export.',
    suggestedAction: 'Исправьте исходные animation data; не синтезируйте replacement keys автоматически.',
  }),
  'animation-integrity-ok': () => ({
    title: 'Целостность animation tracks подтверждена',
    description: 'Animation targets разрешаются корректно, а keyframe arrays содержат конечные и структурно согласованные данные.',
  }),
  'animation-duplicate-timestamps': (i) => ({
    title: 'Обнаружены повторяющиеся animation timestamps',
    description: `В animation tracks найдено ${count(i)} соседних duplicate timestamps.`,
    whyItMatters: 'Duplicate timestamps могут создавать неоднозначную interpolation или лишние keys.',
    suggestedAction: 'Проверьте clips. Автоматическое удаление можно добавить позже как verified AnimationPatch.',
  }),
  'animation-static-channels': (i) => ({
    title: 'Обнаружены статические animation channels',
    description: `${count(i)} tracks сохраняют одно и то же значение на протяжении всего clip.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Static channels обычно безвредны, но могут быть лишними runtime/export data.',
    suggestedAction: 'Действия не требуются; сохраняйте их, пока verified cleanup patch не докажет избыточность.',
  }),
  'animation-root-motion': (i) => ({
    title: 'Обнаружен root motion',
    description: `${count(i)} clips содержат заметное root translation.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Root motion может быть намеренным либо конфликтовать с in-place locomotion runtime.',
    suggestedAction: 'Сначала подтвердите предполагаемую runtime/gameplay модель движения.',
  }),
  'animation-scale-channels': (i) => ({
    title: 'Обнаружена scale animation',
    description: `${count(i)} animation tracks изменяют scale node или bone.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Animated scale может усложнять retargeting, physics и engine assumptions.',
    suggestedAction: 'Проверьте clips перед удалением scale animation.',
  }),
  'animation-extreme-position-jumps': (i) => ({
    title: 'Обнаружены экстремальные скачки position в анимации',
    description: `${count(i)} переходов между соседними keys превышают консервативный порог скачка.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Большой скачок между keys может указывать на discontinuity, unit mismatch или повреждённый export.',
    suggestedAction: 'Проверьте track в контексте. Не сглаживайте и не ограничивайте его автоматически.',
  }),

  'transform-root-scale': () => ({
    title: 'Root scale отличается от 1.0',
    description: 'Корневой объект имеет non-unit scale. Это может быть намеренной конверсией единиц либо unapplied scale.',
    technicalDetails: 'Эталонный scale: [1, 1, 1].',
    whyItMatters: 'Non-unit root scale может влиять на physics, authored distances, animation assumptions и engine import.',
    suggestedAction: 'Проверьте source units и intended engine scale перед изменением.',
  }),
  'transform-root-rotation': (i) => ({
    title: 'Root object имеет ненулевой rotation',
    description: 'Корневой rotation отличается от identity. Это может быть намеренной axis conversion.',
    evidence: evidenceSample(i),
    whyItMatters: 'Root rotation может неожиданно влиять на placement и animation tooling.',
    suggestedAction: 'Проверьте intended forward/up axes. Не сбрасывайте rotation автоматически.',
  }),
  'transform-negative-scale': (i) => ({
    title: 'Обнаружен отрицательный scale',
    description: `${count(i)} objects имеют отрицательные компоненты scale, что может инвертировать winding и взаимодействовать с normal/tangent conventions.`,
    technicalDetails: `Nodes с scale < 0: ${count(i)}.`,
    whyItMatters: 'Negative scale допустим, но усложняет culling, tangent space, physics и transform decomposition.',
    suggestedAction: 'Проверьте nodes в контексте. Не применяйте и не сбрасывайте scale автоматически.',
  }),
  'transform-extreme-scale': (i) => ({
    title: 'Обнаружены экстремальные значения scale',
    description: `${count(i)} objects имеют zero, >1000× либо <0.0001× scale.`,
    whyItMatters: 'Extreme scale уменьшает числовую точность и может указывать на проблемы единиц или импорта.',
    suggestedAction: 'Проверьте units и hierarchy transforms перед изменением.',
  }),
  'transform-suspicious-combinations': (i) => ({
    title: 'Non-uniform scale вместе с rotation',
    description: `${count(i)} objects одновременно используют non-uniform scale и ненулевой rotation.`,
    evidence: evidenceSample(i),
    whyItMatters: 'Такая комбинация усложняет decomposition, physics proxies и round-trip между инструментами.',
    suggestedAction: 'Считайте это информацией для инспекции; не нормализуйте transforms автоматически.',
  }),
  'transform-far-origin': () => ({
    title: 'Центр модели далеко от origin',
    description: 'Центр модели находится необычно далеко от (0,0,0) относительно её собственного размера.',
    whyItMatters: 'Большие world offsets могут уменьшать точность и нарушать ожидания placement/pivot.',
    suggestedAction: 'Подтвердите, что offset намеренный, прежде чем перемещать ассет.',
  }),
};

export function localizeHealthIssue(issue: HealthIssue, language: AppLanguage): HealthIssue {
  if (language !== 'ru') return issue;
  const translated = RU[issue.id]?.(issue);
  if (translated) return { ...issue, ...translated };

  // Keep the RU UI fully Russian even for a newly introduced diagnostic that has
  // not received a dedicated copy pass yet. The stable issue id remains visible
  // as technical evidence so developers can add a precise translation later.
  return {
    ...issue,
    title: `Диагностическая проверка: ${categoryLabel(issue.category, language)}`,
    description: issue.count !== undefined
      ? `Проверка завершена. Измеренное количество: ${issue.count}.`
      : 'Проверка завершена. Для этого правила пока нет отдельного русского описания.',
    evidence: `Идентификатор правила: ${issue.id}`,
    whyItMatters: issue.severity === 'ERROR' || issue.severity === 'WARNING'
      ? 'Находку следует проверить в контексте ассета перед внесением изменений.'
      : 'Это диагностическая информация; сама по себе она не требует автоматического исправления.',
    suggestedAction: issue.repairability === 'MANUAL'
      ? 'Рекомендуется ручная проверка. Asset Doctor не будет угадывать намерение автора.'
      : 'Сверьте находку с назначением ассета и используйте Preview, если для неё доступна verified repair-операция.',
    technicalDetails: undefined,
  };
}

export function categoryLabel(category: HealthCategory, language: AppLanguage): string {
  if (language !== 'ru') return category;
  const labels: Record<HealthCategory, string> = {
    Geometry: 'Геометрия',
    Topology: 'Топология',
    Normals: 'Нормали',
    UV: 'UV',
    Materials: 'Материалы',
    Textures: 'Текстуры',
    Skeleton: 'Скелет',
    Skinning: 'Скиннинг',
    Animations: 'Анимации',
    Transforms: 'Трансформы',
    Performance: 'Производительность',
  };
  return labels[category];
}

export function diagnosticLayerLabel(layer: DiagnosticLayer | undefined, language: AppLanguage): string {
  const value = layer ?? 'Health';
  if (language !== 'ru') return value;
  return value === 'Integrity' ? 'ЦЕЛОСТНОСТЬ' : value === 'Fitness' ? 'СООТВЕТСТВИЕ' : 'СОСТОЯНИЕ';
}

export function severityLabel(severity: HealthSeverity, language: AppLanguage): string {
  if (language !== 'ru') return severity;
  const labels: Record<HealthSeverity, string> = {
    ERROR: 'ОШИБКА',
    WARNING: 'ВНИМАНИЕ',
    INFO: 'ИНФО',
    OK: 'ОК',
    'N/A': 'Н/Д',
    UNKNOWN: 'НЕИЗВЕСТНО',
  };
  return labels[severity];
}

export function repairabilityLabel(repairability: Repairability | undefined, language: AppLanguage): string {
  const value = repairability ?? 'NONE';
  if (language !== 'ru') return value;
  const labels: Record<Repairability, string> = {
    NONE: 'НЕТ',
    SAFE: 'БЕЗОПАСНО',
    CONDITIONAL: 'УСЛОВНО',
    MANUAL: 'ВРУЧНУЮ',
  };
  return labels[value];
}

export function diagnosticElementLabel(
  element: HealthIssue['affectedElement'],
  language: AppLanguage
): string {
  if (!element || language !== 'ru') return element ?? '';
  return element === 'triangle'
    ? 'треугольник'
    : element === 'edge'
      ? 'ребро'
      : element === 'vertex'
        ? 'вершина'
        : 'компонент';
}
