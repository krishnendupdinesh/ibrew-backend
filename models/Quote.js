// MySQL Model for `quotes` and `quote_items` tables using mysql2/promise and transactions
const { getPool } = require("../config/mysql");

function toIso(val) {
  if (!val) return new Date().toISOString();
  return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
}

function formatQuoteItemRow(row) {
  return {
    id: row.item_code || String(row.id),
    name: row.name,
    category: row.category || "",
    quantity: Number(row.quantity || 1),
    unit: row.unit || "",
  };
}

function formatQuoteRow(row, itemRows = []) {
  if (!row) return null;
  const obj = {
    id: row.reference,
    reference: row.reference,
    status: row.status || "new",
    user: row.user_id ? String(row.user_id) : null,
    contact: {
      name: row.contact_name || "",
      company: row.contact_company || "",
      email: row.contact_email || "",
      phone: row.contact_phone || "",
      city: row.contact_city || "",
      timeline: row.contact_timeline || "",
      notes: row.contact_notes || "",
    },
    items: itemRows.map(formatQuoteItemRow),
    createdAt: toIso(row.created_at),
  };

  Object.defineProperty(obj, "toJSON", {
    enumerable: false,
    value: function () {
      return {
        id: this.id,
        status: this.status,
        user: this.user,
        contact: this.contact,
        items: this.items,
        createdAt: this.createdAt,
      };
    },
  });

  return obj;
}

async function attachItemsToQuotes(connOrPool, quoteRows) {
  if (!quoteRows || quoteRows.length === 0) return [];
  const quoteIds = quoteRows.map((r) => r.id);
  const placeholders = quoteIds.map(() => "?").join(", ");
  const [itemRows] = await connOrPool.execute(
    `SELECT * FROM \`quote_items\` WHERE \`quote_id\` IN (${placeholders}) ORDER BY \`id\` ASC`,
    quoteIds
  );

  const itemsByQuoteId = new Map();
  for (const item of itemRows) {
    const list = itemsByQuoteId.get(item.quote_id) || [];
    list.push(item);
    itemsByQuoteId.set(item.quote_id, list);
  }

  return quoteRows.map((r) => formatQuoteRow(r, itemsByQuoteId.get(r.id) || []));
}

const Quote = {
  async findAllSorted() {
    const pool = getPool();
    const [rows] = await pool.execute(
      "SELECT * FROM `quotes` ORDER BY `created_at` DESC, `id` DESC"
    );
    return attachItemsToQuotes(pool, rows);
  },

  async findByReference(reference) {
    const ref = String(reference || "").trim();
    if (!ref) return null;
    const pool = getPool();
    const [rows] = await pool.execute(
      "SELECT * FROM `quotes` WHERE `reference` = ? LIMIT 1",
      [ref]
    );
    if (rows.length === 0) return null;
    const [formatted] = await attachItemsToQuotes(pool, [rows[0]]);
    return formatted || null;
  },

  async create(data) {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const reference = String(data.reference || "").trim();
      const status = ["new", "contacted", "quoted", "closed"].includes(data.status)
        ? data.status
        : "new";

      // Resolve integer user_id only if valid in `users`
      let userId = null;
      if (data.user && /^\d+$/.test(String(data.user))) {
        const [uRows] = await conn.execute("SELECT `id` FROM `users` WHERE `id` = ? LIMIT 1", [
          Number(data.user),
        ]);
        if (uRows.length > 0) userId = uRows[0].id;
      }

      const contact = data.contact || {};
      const mongoId = data.mongoId ? String(data.mongoId) : null;

      const [res] = await conn.execute(
        `INSERT INTO \`quotes\`
         (\`mongo_id\`, \`reference\`, \`status\`, \`user_id\`, \`contact_name\`, \`contact_company\`, \`contact_email\`, \`contact_phone\`, \`contact_city\`, \`contact_timeline\`, \`contact_notes\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mongoId,
          reference,
          status,
          userId,
          String(contact.name || "").trim(),
          String(contact.company || "").trim(),
          String(contact.email || "").trim(),
          String(contact.phone || "").trim(),
          String(contact.city || "").trim(),
          String(contact.timeline || "").trim(),
          String(contact.notes || "").trim(),
        ]
      );

      const quoteDbId = res.insertId;
      const items = Array.isArray(data.items) ? data.items : [];

      for (const item of items) {
        await conn.execute(
          `INSERT INTO \`quote_items\` (\`quote_id\`, \`item_code\`, \`name\`, \`category\`, \`quantity\`, \`unit\`)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            quoteDbId,
            String(item.id || "").trim(),
            String(item.name || "").trim(),
            String(item.category || "").trim(),
            Math.max(1, Math.floor(Number(item.quantity || 1))),
            String(item.unit || "").trim(),
          ]
        );
      }

      await conn.commit();
      return Quote.findByReference(reference);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async findOneAndUpdate(filter, update) {
    const reference = String(filter?.reference || filter?.id || "").trim();
    if (!reference) return null;

    const payload = update.$set ? update.$set : update;
    const nextStatus = payload.status;

    const pool = getPool();
    const [res] = await pool.execute(
      "UPDATE `quotes` SET `status` = ? WHERE `reference` = ?",
      [nextStatus, reference]
    );
    if (res.affectedRows === 0) return null;
    return Quote.findByReference(reference);
  },
};

module.exports = Quote;
