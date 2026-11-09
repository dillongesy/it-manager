import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { ipInCidr } from './lib/cidr.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import inventoryRoutes from './routes/inventory.js';
import workOrdersRoutes from './routes/work-orders.js';
import photosRoutes from './routes/photos.js';
import auditRoutes from './routes/audit.js';
import serviceRoutes from './routes/service.js';
import platformServiceRoutes from './routes/platform-service.js';
import brandingRoutes from './routes/branding.js';

const app = express();

app.set('trust proxy', config.trustProxy);
app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(express.json({ limit: '40mb' }));   // the Portal's branding push carries base64 images
app.use(cookieParser());

// Least privilege on the bridge (Docker): a connection that arrives over the
// internal bridge network — i.e. from the Portal API — may only use the service
// endpoints. It can't touch logins, users or anything else on the Field App.
if (config.serviceAllowedCidr) {
  app.use((req, res, next) => {
    if (ipInCidr(req.socket.remoteAddress, config.serviceAllowedCidr) && !req.path.startsWith('/api/service/')) {
      return res.status(404).json({ error: 'Not found.' });
    }
    next();
  });
}

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }), authRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/inventory',   inventoryRoutes);
app.use('/api/work-orders', workOrdersRoutes);
app.use('/api/photos',      photosRoutes);
app.use('/api/audit',       auditRoutes);

// Shared-inventory bridge — the IT Portal is the only intended caller (service token).
app.use('/api/service',     platformServiceRoutes);
app.use('/api/service',     serviceRoutes);
app.use('/api/branding',    brandingRoutes);

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'field' }));
app.use(errorHandler);

export default app;
