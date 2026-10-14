const russian:Record<string,string>={
  'Select an active joint.':'Выберите сустав.',
  'Root joints cannot be deleted.':'Корневой сустав удалять нельзя.',
  'Delete only a leaf joint without children or attachments.':'Можно удалить только конечный сустав без дочерних костей и вложенных объектов.',
  'The skin skeleton anchor cannot be deleted.':'Опорный сустав скелета удалять нельзя.',
  'Animated joints cannot be deleted.':'Удаление заблокировано: у сустава есть анимационные дорожки.',
  'Weighted joints cannot be deleted.':'Удаление заблокировано: сустав имеет веса вершин.',
  'The last skin joint cannot be deleted.':'Последний сустав скелета удалять нельзя.',
  'Compressed or additional skin influences require a separate deletion contract.':'Удаление для сжатого меша или дополнительных наборов весов пока не поддерживается.',
  'Skin influence attributes are invalid.':'Некорректные веса или индексы суставов: удаление заблокировано.',
  'Original skin weights need repair and reimport before safe joint deletion.':'Исходные веса требуют ремонта и повторного открытия GLB перед удалением сустава.',
  'Shared geometry requires conflicting joint-index rewrites.':'Общий меш использует разные порядки суставов: безопасное удаление невозможно.',
  'Export and reimport verified repairs before deleting a joint.':'Сначала сохраните и заново откройте GLB с проверенными ремонтами.',
  'Enter Edit Skeleton before changing joints.':'Для добавления или удаления перейдите в режим «Редактировать».',
  'Return to Hybrid shading before deleting a joint.':'Для удаления сустава верните шейдинг Hybrid.',
  'Joint-index history conflicts with later geometry changes.':'История удаления конфликтует с более поздними изменениями меша. Они сохранены; повторение операции заблокировано.',
};
export function jointDeleteMessage(reason:string|null|undefined,language:string) {return reason?(language==='ru'?russian[reason]??reason:reason):null;}
