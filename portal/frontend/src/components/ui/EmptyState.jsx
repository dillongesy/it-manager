export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      {Icon && <Icon size={32} className="text-gray-700 mb-3" />}
      <p className="text-gray-400 font-medium mb-1">{title}</p>
      {description && <p className="text-gray-600 text-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}
