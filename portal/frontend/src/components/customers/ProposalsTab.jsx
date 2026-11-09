import { FileManager } from './FileManager.jsx';

// Business proposals & contracts - mostly PDFs, viewable in-browser.
export function ProposalsTab({ customerId, locations, companyName }) {
  return (
    <FileManager
      customerId={customerId}
      kind="proposal"
      locations={locations}
      companyName={companyName}
      emptyHint="Upload business proposals and contracts (PDFs view in-browser)."
      defaultPlaceholder="optional — e.g. Proposals, Contracts"
    />
  );
}
