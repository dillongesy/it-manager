import { FileManager } from './FileManager.jsx';

// General attachments — diagrams, floor plans, exports, photos, etc.
// Proposals & contracts live in their own tab (ProposalsTab).
export function FilesTab({ customerId, locations, companyName }) {
  return (
    <FileManager
      customerId={customerId}
      kind="file"
      locations={locations}
      companyName={companyName}
      emptyHint="Upload diagrams, floor plans, exports, and other attachments."
      defaultPlaceholder="optional — e.g. Floor Plans, Diagrams"
    />
  );
}
