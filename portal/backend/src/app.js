import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import customersRoutes from './routes/customers.js';
import customerDevicesRoutes from './routes/customer-devices.js';
import customerCredentialsRoutes from './routes/customer-credentials.js';
import customerCamerasRoutes from './routes/customer-cameras.js';
import customerGuidesRoutes from './routes/customer-guides.js';
import customerFilesRoutes from './routes/customer-files.js';
import workOrdersRoutes from './routes/work-orders.js';
import inventoryRoutes from './routes/inventory.js';
import searchRoutes from './routes/search.js';
import auditRoutes from './routes/audit.js';
import customerContactsRoutes from './routes/customer-contacts.js';
import customerLocationsRoutes from './routes/customer-locations.js';
import customerRatesRoutes from './routes/customer-rates.js';
import customerCameraSharedRoutes from './routes/customer-camera-shared.js';
import customerCameraCamerasRoutes from './routes/customer-camera-cameras.js';
import customerLicensesRoutes from './routes/customer-licenses.js';
import customerRecurringChargesRoutes from './routes/customer-recurring-charges.js';
import orderLogRoutes from './routes/order-log.js';
import tasksRoutes from './routes/tasks.js';
import licensesRoutes from './routes/licenses.js';
import recurringChargesRoutes from './routes/recurring-charges.js';
import analyticsRoutes from './routes/analytics.js';
import fieldJobsRoutes from './routes/field-jobs.js';
import serviceCatalogRoutes from './routes/service-catalog.js';
import customerExportRoutes from './routes/customer-export.js';
import { connectWiseRouter, customerConnectWiseRouter } from './routes/connectwise.js';
import { unifiRouter, customerUnifiRouter } from './routes/unifi.js';
import { warrantyRouter } from './routes/warranty.js';
import { screenConnectRouter } from './routes/screenconnect.js';
import { integrationsRouter, customerIntegrationsRouter } from './routes/integrations.js';
import { tdSynnexRouter, customerTdSynnexRouter } from './routes/tdsynnex.js';
import { auvikRouter } from './routes/auvik.js';
import { outlookRouter } from './routes/outlook.js';
import { seatSyncRouter, customerSeatSyncRouter } from './routes/seat-sync.js';
import setupRoutes from './routes/setup.js';
import brandingRoutes from './routes/branding.js';
import { adminRouter } from './routes/admin.js';
import { ipInCidr } from './lib/cidr.js';

const app = express();

app.set('trust proxy', config.trustProxy);

// The Portal is LAN only. portal-web already refuses the networks of the Field App's
// entrances; this repeats the check in case a request reaches the API another way.
if (config.deniedSources.length) {
  app.use((req, res, next) => (config.deniedSources.some(c => ipInCidr(req.ip, c))
    ? res.status(403).json({ error: 'Forbidden.' })
    : next()));
}

app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
  // List endpoints report the full match count here so the client can page through
  // everything; without exposing it the browser hides the header from JS.
  exposedHeaders: ['X-Total-Count'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Brute-force protection applies to login only. Office users typically share one
// public or VPN address, and every signed-in client refreshes its token about every
// 15 minutes, so an IP-keyed limit on /refresh, /me or /logout would lock out
// legitimate users. A generous per-IP login limit still blocks password guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/branding', brandingRoutes);
app.use('/api/admin', adminRouter);
app.use('/api/users', usersRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/work-orders', workOrdersRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/customers/:customerId/devices',     customerDevicesRoutes);
app.use('/api/customers/:customerId/credentials', customerCredentialsRoutes);
app.use('/api/customers/:customerId/cameras',     customerCamerasRoutes);
app.use('/api/customers/:customerId/guides',      customerGuidesRoutes);
app.use('/api/customers/:customerId/files',       customerFilesRoutes);
app.use('/api/customers/:customerId/contacts',                         customerContactsRoutes);
app.use('/api/customers/:customerId/locations',                        customerLocationsRoutes);
app.use('/api/customers/:customerId/rates',                            customerRatesRoutes);
app.use('/api/customers/:customerId/cameras/:cameraId/shared',         customerCameraSharedRoutes);
app.use('/api/customers/:customerId/cameras/:cameraId/cameras',        customerCameraCamerasRoutes);
app.use('/api/customers/:customerId/licenses',                         customerLicensesRoutes);
app.use('/api/customers/:customerId/recurring-charges',                customerRecurringChargesRoutes);
app.use('/api/customers/:customerId/export',                           customerExportRoutes);
app.use('/api/customers/:customerId/connectwise',                      customerConnectWiseRouter);
app.use('/api/customers/:customerId/unifi',                            customerUnifiRouter);
app.use('/api/customers/:customerId/warranty',                         warrantyRouter);
app.use('/api/customers/:customerId/screenconnect',                    screenConnectRouter);
app.use('/api/customers/:customerId/integrations',                     customerIntegrationsRouter);
app.use('/api/customers/:customerId/tdsynnex',                         customerTdSynnexRouter);
app.use('/api/customers/:customerId/auvik',                            auvikRouter);
app.use('/api/customers/:customerId/seat-sync',                        customerSeatSyncRouter);
app.use('/api/order-log', orderLogRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/licenses', licensesRoutes);
app.use('/api/recurring-charges', recurringChargesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/field-jobs', fieldJobsRoutes);
app.use('/api/service-catalog', serviceCatalogRoutes);
app.use('/api/connectwise', connectWiseRouter);
app.use('/api/unifi', unifiRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/outlook', outlookRouter);
app.use('/api/tdsynnex', tdSynnexRouter);
app.use('/api/seat-sync', seatSyncRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use(errorHandler);

export default app;
