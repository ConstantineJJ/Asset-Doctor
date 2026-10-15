export const floorTiles=[
 {id:'grass',labelRu:'Зелёная трава',labelEn:'Green grass',file:'T3D_Green_Grass.png',icon:'🌿',repeat:[20,20]},
 {id:'road',labelRu:'Асфальт',labelEn:'Asphalt',file:'T3D_asphalt_surface_3.png',icon:'🛣️',repeat:[20,20]},
 {id:'sand',labelRu:'Чистый песок',labelEn:'Clean sand',file:'Desert_clean.png',icon:'🏖️',repeat:[20,20]},
 {id:'forest-floor',labelRu:'Лесная подстилка',labelEn:'Forest floor',file:'Forest_floor_2.png',icon:'🌲',repeat:[20,20]},
 {id:'grass-2',labelRu:'Трава — вариант 2',labelEn:'Grass — variant 2',file:'Green_grass_2.png',icon:'🌱',repeat:[20,20]},
 {id:'dry-grass',labelRu:'Сухая трава',labelEn:'Dry grass',file:'T3D_Grass_Dry.png',icon:'🌾',repeat:[20,20]},
 {id:'rock-floor',labelRu:'Каменный грунт',labelEn:'Rock floor',file:'T3D_Rock_Floor.png',icon:'🪨',repeat:[20,20]},
 {id:'small-rocks',labelRu:'Мелкие камни',labelEn:'Small rocks',file:'T3D_Small_Rock_Ground.png',icon:'🪨',repeat:[20,20]},
 {id:'sand-rocks',labelRu:'Песок и скалы',labelEn:'Sand and rocks',file:'sand_rock2.png',icon:'🏜️',repeat:[8,8*1408/768]},
 {id:'city-map',labelRu:'Карта города',labelEn:'City map',file:'City_map.png',icon:'🗺️',repeat:[2,2*1408/768]},
 {id:'techno-desert',labelRu:'Техно-пустыня',labelEn:'Techno desert',file:'TechnoDesert.png',icon:'⚙️',repeat:[2,2*1408/768]},
] as const;
export const surfaceChoices=[
 {id:'grid',labelRu:'Сетка студии',labelEn:'Studio Grid',icon:'📐'},
 ...floorTiles,
 {id:'tile',labelRu:'Керамогранит',labelEn:'Porcelain Tile',icon:'🏛️'},
 {id:'cobblestone',labelRu:'Брусчатка',labelEn:'Cobblestone',icon:'🧱'},
 {id:'factory',labelRu:'Завод / Цех',labelEn:'Factory / Workshop',icon:'🏭'},
 {id:'moon',labelRu:'Лунная поверхность',labelEn:'Moon Surface',icon:'🌑'},
 {id:'countryside',labelRu:'Сельская местность',labelEn:'Countryside',icon:'🌾'},
 {id:'wood',labelRu:'Деревянный пол',labelEn:'Wood Floor',icon:'🪵'},
 {id:'none',labelRu:'Без поверхности',labelEn:'No Surface',icon:'🚫'},
] as const;
