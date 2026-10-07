const STATUSES = new Set(['Recibido', 'Preparando', 'Listo', 'Entregado', 'Cerrado']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handleApi(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/orders') {
    const { results } = await env.DB.prepare(
      'SELECT id, table_name, items_json, notes, status, created_at, closed_at FROM orders ORDER BY created_at DESC'
    ).all();
    return json({ orders: results.map(row => ({
      id: row.id, table: row.table_name, items: JSON.parse(row.items_json), notes: row.notes,
      status: row.status, created: row.created_at, ...(row.closed_at ? { closedAt: row.closed_at } : {}),
    })) });
  }

  if (request.method === 'POST' && url.pathname === '/api/orders') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const table = String(body.table || '');
    const items = body.items;
    const notes = String(body.notes || '').slice(0, 120);
    if (!/^Mesa ([1-9]|1[0-2])$/.test(table) || !Array.isArray(items) || items.length < 1 || items.length > 50)
      return json({ error: 'Pedido inválido' }, 400);
    for (const item of items) {
      if (typeof item.name !== 'string' || item.name.length > 120 || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99 || !(item.price === null || (Number.isFinite(item.price) && item.price >= 0)))
        return json({ error: 'Producto inválido' }, 400);
    }
    const id = crypto.randomUUID().slice(0, 8).toUpperCase();
    const created = new Date().toISOString();
    await env.DB.prepare('INSERT INTO orders (id, table_name, items_json, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, table, JSON.stringify(items), notes, 'Recibido', created).run();
    return json({ order: { id, table, items, notes, status: 'Recibido', created } }, 201);
  }

  const match = url.pathname.match(/^\/api\/orders\/([A-Z0-9-]+)$/i);
  if (request.method === 'PATCH' && match) {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const status = String(body.status || '');
    if (!STATUSES.has(status)) return json({ error: 'Estado inválido' }, 400);
    const closedAt = status === 'Cerrado' ? new Date().toISOString() : null;
    const result = await env.DB.prepare('UPDATE orders SET status = ?, closed_at = ? WHERE id = ?')
      .bind(status, closedAt, match[1]).run();
    if (!result.meta.changes) return json({ error: 'Pedido no encontrado' }, 404);
    return json({ ok: true });
  }
  return json({ error: 'Ruta no encontrada' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, url); }
      catch (error) { console.error(error); return json({ error: 'Error interno del servidor' }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
};
