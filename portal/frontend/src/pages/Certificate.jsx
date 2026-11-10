import { ShieldCheck } from 'lucide-react';
import { CertificateGuide } from '../components/help/CertificateGuide.jsx';

// /certificate: how to trust the server's certificate. Open to every signed-in user.
export function Certificate() {
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-4 flex items-center gap-2"><ShieldCheck size={22} /> Trust this server's certificate</h1>
      <CertificateGuide />
    </div>
  );
}
