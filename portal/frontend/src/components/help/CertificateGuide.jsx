import { useEffect, useState } from 'react';
import { Download, Monitor, Network, Smartphone, Terminal, RefreshCcw } from 'lucide-react';

// How to trust the server's certificate authority on each device, so browsers stop
// warning about the Portal's certificate. Shown in Admin → Certificate and at
// /certificate for every signed-in user.

const CA_URL = '/ca.crt';
const FILE = 'it-manager-ca.crt';

/** SHA-1 thumbprint (as Windows shows it), SHA-256 fingerprint and name of the CA certificate. */
function useFingerprints() {
  const [prints, setPrints] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const pem = await (await fetch(CA_URL, { cache: 'no-store' })).text();
        const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
        const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const hex = async (alg) => [...new Uint8Array(await crypto.subtle.digest(alg, der))]
          .map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase();
        const [sha1, sha256] = await Promise.all([hex('SHA-1'), hex('SHA-256')]);
        // The authority's name, e.g. "IT Manager Local CA 3f9a" (the suffix differs per installation).
        const name = String.fromCharCode(...der).match(/IT Manager Local CA [0-9a-f]{4}/)?.[0] ?? null;
        if (live) setPrints({ sha1, sha256, name });
      } catch {
        if (live) setPrints(null);
      }
    })();
    return () => { live = false; };
  }, []);
  return prints;
}

const Section = ({ icon: Icon, title, children }) => (
  <section className="card p-5 space-y-3 text-sm text-gray-400">
    <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><Icon size={16} /> {title}</h2>
    {children}
  </section>
);
const Steps = ({ children }) => <ol className="list-decimal pl-5 space-y-2">{children}</ol>;
const B = ({ children }) => <strong className="text-gray-200">{children}</strong>;
const C = ({ children }) => <code className="font-mono text-gray-300 bg-surface-900 px-1 rounded-sm">{children}</code>;

export function CertificateGuide() {
  const prints = useFingerprints();
  const origin = window.location.origin;

  return (
    <div className="space-y-4">
      <section className="card p-5 space-y-3 text-sm text-gray-400">
        <p>
          The Portal's HTTPS certificate comes from a certificate authority created on this server, which browsers don't
          know yet, so they warn the first time. Install the authority's certificate once on each computer and phone and
          the warning goes away for good. It does not give this server any access to the device.
        </p>
        <p>
          The same certificate covers the Portal and the Field App's office address, on computers and on phones. Staff who
          open the Portal on a phone need it installed on the phone too.
        </p>
        <a href={CA_URL} download={FILE} className="btn-primary inline-flex items-center gap-1.5"><Download size={14} /> Download {FILE}</a>
        <p className="text-xs">Also available at <C>{origin}{CA_URL}</C>, for devices that aren't signed in.</p>
        {prints && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            {prints.name && <><dt>Name</dt><dd className="text-gray-300">{prints.name}</dd></>}
            <dt>Thumbprint (Windows)</dt><dd className="font-mono text-gray-300 break-all">{prints.sha1}</dd>
            <dt>SHA-256</dt><dd className="font-mono text-gray-300 break-all">{prints.sha256}</dd>
          </dl>
        )}
      </section>

      <Section icon={Monitor} title="Windows: one computer">
        <p>Needs an administrator account on the computer. Works for Edge and Chrome.</p>
        <Steps>
          <li>Click <B>Download {FILE}</B> above. The file lands in your Downloads folder.</li>
          <li>Open the Downloads folder and double-click <B>{FILE}</B>. If Windows asks whether to open the file, click <B>Open</B>.</li>
          <li>
            In the Certificate window, open the <B>Details</B> tab, select <B>Thumbprint</B>, and check it matches the
            thumbprint shown above. Then return to the <B>General</B> tab.
          </li>
          <li>Click <B>Install Certificate…</B>.</li>
          <li>Under Store Location choose <B>Local Machine</B> and click <B>Next</B>. Approve the administrator prompt.</li>
          <li>Choose <B>Place all certificates in the following store</B>, click <B>Browse…</B>, select <B>Trusted Root Certification Authorities</B>, and click <B>OK</B>.</li>
          <li>Click <B>Next</B>, then <B>Finish</B>. Windows shows "The import was successful."</li>
          <li>Close every browser window, open the browser again and go to <C>{origin}</C>. There is no warning now.</li>
        </Steps>
        <p className="text-xs">
          Always choose <B>Local Machine</B>, so the certificate is in the computer's store for every account. A copy installed for
          Current User works only for one Windows account and is easy to miss when it has to be removed.
        </p>
        <p className="text-xs">
          Firefox: if it still warns, open Settings → Privacy &amp; Security → Certificates → <B>View Certificates…</B> →
          <B> Authorities</B> → <B>Import…</B>, choose the file and tick <B>Trust this CA to identify websites</B>.
        </p>
      </Section>

      <Section icon={Terminal} title="Windows: PowerShell">
        <p>Run PowerShell <B>as administrator</B>, in the folder where you saved the file:</p>
        <pre className="font-mono text-xs text-gray-300 bg-surface-900 border border-surface-600 rounded-md p-3 overflow-x-auto">
          {`Import-Certificate -FilePath .\\${FILE} -CertStoreLocation Cert:\\LocalMachine\\Root`}
        </pre>
      </Section>

      <Section icon={Network} title="Windows: every computer in a domain (Group Policy)">
        <Steps>
          <li>On a domain controller, or a computer with the Remote Server Administration Tools, open <B>Group Policy Management</B>.</li>
          <li>Right-click the domain (or the OU that holds the computers) and choose <B>Create a GPO in this domain, and Link it here…</B>. Name it, for example, "Trust IT Manager certificate".</li>
          <li>Right-click the new GPO and choose <B>Edit</B>.</li>
          <li>Go to <B>Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities</B>.</li>
          <li>Right-click <B>Trusted Root Certification Authorities</B>, choose <B>Import…</B>, click <B>Next</B>, browse to {FILE}, and click <B>Next</B>, <B>Next</B>, <B>Finish</B>.</li>
          <li>Computers apply it at their next Group Policy refresh (within about 90 minutes), or immediately after <C>gpupdate /force</C>. Restart the browser afterwards.</li>
        </Steps>
        <p className="text-xs">
          Microsoft Intune: Devices → Configuration → Create → Windows 10 and later → Templates → <B>Trusted certificate</B>.
          Upload the file (rename it to <C>.cer</C> if Intune asks), set Destination store to <B>Computer certificate store - Root</B>,
          and assign it to your device groups.
        </p>
      </Section>

      <Section icon={RefreshCcw} title="When the certificate changes, and removing an old one">
        <p>
          Changing the office networks or the server's DNS names (Admin → System) re-issues the server's certificate, but it is
          signed by the same authority, so <B>devices need nothing new</B>.
        </p>
        <p>
          Only <B>reinstalling IT Manager</B> (a new server, or a server wiped and set up again) creates a new authority. Its name
          ends in different characters{prints?.name ? <> (this server's is <B>{prints.name}</B>)</> : ''}. Install the new one as above,
          then remove the old one, which no longer protects anything.
        </p>
        <p><B>Windows, by hand</B> (the computer's store, where the steps above install it):</p>
        <Steps>
          <li>Press <B>Windows + R</B>, type <C>certlm.msc</C> and press Enter. Approve the administrator prompt.</li>
          <li>Open <B>Trusted Root Certification Authorities → Certificates</B>.</li>
          <li>
            Find every <B>IT Manager Local CA …</B> in the Issued To column. Keep the one{prints?.name ? <> named <B>{prints.name}</B></> : ' matching this server'};
            to check, double-click it and compare the Thumbprint on the Details tab with the one above.
          </li>
          <li>Right-click each other one → <B>Delete</B> → <B>Yes</B>. Then restart the browser.</li>
        </Steps>
        <p><B>Windows, PowerShell as administrator</B>: removes every IT Manager authority except this server's{prints?.sha1 ? '' : ' (open this page from the server to fill in its thumbprint)'}.</p>
        <pre className="font-mono text-xs text-gray-300 bg-surface-900 border border-surface-600 rounded-md p-3 overflow-x-auto">
          {`Get-ChildItem Cert:\\LocalMachine\\Root |
  Where-Object { $_.Subject -like '*IT Manager Local CA*' -and $_.Thumbprint -ne '${prints?.sha1?.replace(/ /g, '') ?? 'THUMBPRINT'}' } |
  Remove-Item`}
        </pre>
        <p className="text-xs">
          Group Policy: in the GPO, under Trusted Root Certification Authorities, delete the old certificate and import the new one.
          Intune: replace the file in the Trusted certificate profile.
          iPhone: Settings → General → <B>VPN &amp; Device Management</B> → the old profile → <B>Remove Profile</B>.
          Android: Encryption &amp; credentials → <B>User credentials</B> → the old certificate → <B>Remove</B>.
          Mac: delete it from the System keychain in Keychain Access.
        </p>
      </Section>

      <Section icon={Smartphone} title="Phones, tablets and Macs">
        <p><B>iPhone and iPad:</B> open <C>{origin}{CA_URL}</C> in Safari and allow the download. Open Settings → <B>Profile Downloaded</B> → <B>Install</B> and enter the passcode. Then go to Settings → General → About → <B>Certificate Trust Settings</B> and turn on full trust for "IT Manager Local CA".</p>
        <p><B>Android:</B> download the file, then open Settings → Security &amp; privacy → More security settings → Encryption &amp; credentials → <B>Install a certificate</B> → <B>CA certificate</B> → Install anyway, and choose the file. Menu names vary by manufacturer.</p>
        <p><B>Mac:</B> double-click the file and add it to the <B>System</B> keychain. In Keychain Access, double-click the certificate, expand <B>Trust</B>, and set "When using this certificate" to <B>Always Trust</B>.</p>
      </Section>
    </div>
  );
}
