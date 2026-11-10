import { useEffect, useState } from 'react';
import { Download, Monitor, Network, Smartphone, Terminal } from 'lucide-react';

// How to trust the server's certificate authority on each device, so browsers stop
// warning about the Portal's certificate. Shown in Admin → Certificate and at
// /certificate for every signed-in user.

const CA_URL = '/ca.crt';
const FILE = 'it-manager-ca.crt';

/** SHA-1 thumbprint (as Windows shows it) and SHA-256 fingerprint of the CA certificate. */
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
        if (live) setPrints({ sha1, sha256 });
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
        <a href={CA_URL} download={FILE} className="btn-primary inline-flex items-center gap-1.5"><Download size={14} /> Download {FILE}</a>
        <p className="text-xs">Also available at <C>{origin}{CA_URL}</C>, for devices that aren't signed in.</p>
        {prints && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
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
          Without administrator rights, choose <B>Current User</B> in step 5 instead. It then works only for your Windows account,
          and Windows asks you to confirm the install.
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

      <Section icon={Smartphone} title="Phones, tablets and Macs">
        <p><B>iPhone and iPad:</B> open <C>{origin}{CA_URL}</C> in Safari and allow the download. Open Settings → <B>Profile Downloaded</B> → <B>Install</B> and enter the passcode. Then go to Settings → General → About → <B>Certificate Trust Settings</B> and turn on full trust for "IT Manager Local CA".</p>
        <p><B>Android:</B> download the file, then open Settings → Security &amp; privacy → More security settings → Encryption &amp; credentials → <B>Install a certificate</B> → <B>CA certificate</B> → Install anyway, and choose the file. Menu names vary by manufacturer.</p>
        <p><B>Mac:</B> double-click the file and add it to the <B>System</B> keychain. In Keychain Access, double-click the certificate, expand <B>Trust</B>, and set "When using this certificate" to <B>Always Trust</B>.</p>
      </Section>
    </div>
  );
}
