/** Form field label + optional hint. Shared by the job form and its day cards. */
export default function Labeled({ label, hint, children }) {
  return (
    <div className="min-w-0">
      <label className="block text-sm text-gray-400 mb-1.5">
        {label}{hint && <span className="text-gray-600"> — {hint}</span>}
      </label>
      {children}
    </div>
  );
}
