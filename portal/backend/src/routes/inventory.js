import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { fieldInventory, isFieldConfigured } from '../lib/field-client.js';

const router = Router();

// Shared inventory lives in the Field App. These endpoints proxy the Portal's
// requests across the one-way bridge so IT staff can view and consume stock
// without leaving the Portal. Read here, write only via checkout.

// GET /api/inventory/status — is the bridge wired up?
router.get('/status', requireAuth, (req, res) => {
  res.json({ configured: isFieldConfigured() });
});

// GET /api/inventory — list shared stock
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { search, category, lowStock } = req.query;
    const items = await fieldInventory.list({ search, category, lowStock });
    res.json(items);
  } catch (err) { next(err); }
});

// GET /api/inventory/categories
router.get('/categories', requireAuth, async (req, res, next) => {
  try {
    res.json(await fieldInventory.categories());
  } catch (err) { next(err); }
});

// GET /api/inventory/:id — one item + ledger
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    res.json(await fieldInventory.get(req.params.id));
  } catch (err) { next(err); }
});

// POST /api/inventory — IT side adds a new shared item (written in the Field DB)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const item = await fieldInventory.create({ ...req.body, actor: req.user.fullName });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'inventory', entityId: item.id,
      entityName: `${item.name} (${item.sku}) — created (shared inventory)`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// PATCH /api/inventory/:id — IT side edits item metadata
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const item = await fieldInventory.update(req.params.id, { ...req.body, actor: req.user.fullName });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `${item.name} (${item.sku}) — edited (shared inventory)`,
      ipAddress: getClientIp(req),
    });
    res.json(item);
  } catch (err) { next(err); }
});

// POST /api/inventory/:id/receive — IT side adds stock
router.post('/:id/receive', requireAuth, async (req, res, next) => {
  try {
    const { quantity, notes } = req.body ?? {};
    const item = await fieldInventory.receive(req.params.id, { quantity, actor: req.user.fullName, notes });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `${item.name} — received ${quantity} (shared inventory)`,
      ipAddress: getClientIp(req),
    });
    res.json(item);
  } catch (err) { next(err); }
});

// POST /api/inventory/:id/adjust — IT side corrects the on-hand count
router.post('/:id/adjust', requireAuth, async (req, res, next) => {
  try {
    const { new_quantity, notes } = req.body ?? {};
    const item = await fieldInventory.adjust(req.params.id, { new_quantity, actor: req.user.fullName, notes });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `${item.name} — adjusted to ${new_quantity} (shared inventory)`,
      ipAddress: getClientIp(req),
    });
    res.json(item);
  } catch (err) { next(err); }
});

// POST /api/inventory/:id/checkout — IT side uses shared stock
router.post('/:id/checkout', requireAuth, async (req, res, next) => {
  try {
    const { quantity, notes } = req.body ?? {};
    const item = await fieldInventory.checkout(req.params.id, {
      quantity,
      actor: req.user.fullName,   // stamped into the Field ledger
      notes,
    });

    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `${item.name} — used ${quantity} (shared inventory)`,
      ipAddress: getClientIp(req),
    });

    res.json(item);
  } catch (err) { next(err); }
});

// DELETE /api/inventory/:id — IT side removes a shared item. The Field App decides
// whether it's a hard delete (no history) or an archive (has ledger history) and tells
// us via `mode`; we mirror it into the Portal audit log.
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await fieldInventory.remove(req.params.id, { actor: req.user.fullName });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `${result.name} (${result.sku}) — ${result.mode} (shared inventory)`,
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
