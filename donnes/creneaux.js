import { Router } from 'express';
import pool from '../db.js';
import dotenv from 'dotenv';

dotenv.config();

const creneauxRouter = Router();

// Middleware async pour gérer les erreurs
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===== COUNT - Nombre total de créneaux =====
creneauxRouter.get('/count', asyncHandler(async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM creneaux_expedition');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Error counting creneaux:', error);
    res.status(500).json({ error: 'Erreur lors du comptage des créneaux' });
  }
}));

// ===== CREATE - Ajouter un créneau =====
creneauxRouter.post('/', asyncHandler(async (req, res) => {
  const {
    heure_depart,
    lieu_depart,
    destination,
    capacite_max,
    frais_par_kg,
    poids_max_colis,
    type_transport,
    date_expedition
  } = req.body;

  // Validation des champs obligatoires
  const requiredFields = ['heure_depart', 'lieu_depart', 'destination', 'capacite_max', 'frais_par_kg', 'poids_max_colis', 'date_expedition'];
  for (let field of requiredFields) {
    if (!req.body[field]) {
      return res.status(400).json({ error: `Champ obligatoire manquant: ${field}` });
    }
  }

  // Validation du type de transport
  const validTransportTypes = ['standard', 'express', 'prioritaire'];
  if (type_transport && !validTransportTypes.includes(type_transport)) {
    return res.status(400).json({ error: 'Type de transport invalide. Doit être: standard, express ou prioritaire' });
  }

  // Validation des nombres positifs
  if (capacite_max <= 0 || frais_par_kg <= 0 || poids_max_colis <= 0) {
    return res.status(400).json({ error: 'La capacité, les frais et le poids maximum doivent être supérieurs à 0' });
  }

  const result = await pool.query(
    `INSERT INTO creneaux_expedition 
    (heure_depart, lieu_depart, destination, capacite_max, frais_par_kg, poids_max_colis, type_transport, date_expedition)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
    RETURNING *`,
    [
      heure_depart,
      lieu_depart,
      destination,
      capacite_max,
      frais_par_kg,
      poids_max_colis,
      type_transport || 'standard',
      date_expedition
    ]
  );

  res.status(201).json(result.rows[0]);
}));

// ===== READ - Tous les créneaux =====
creneauxRouter.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, sortBy = 'id', order = 'DESC' } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const allowedSortColumns = ['id', 'lieu_depart', 'destination', 'date_expedition', 'heure_depart', 'date_creation'];
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
  const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  let query = `
    SELECT ce.*, 
           COUNT(c.id) as nombre_colis_actuels,
           (ce.capacite_max - COUNT(c.id)) as places_restantes
    FROM creneaux_expedition ce
    LEFT JOIN colis c ON ce.id = c.creneau_id
  `;
  let countQuery = 'SELECT COUNT(*) FROM creneaux_expedition';
  const params = [];
  const groupBy = ' GROUP BY ce.id';

  if (search) {
    const searchCondition = ' WHERE ce.lieu_depart ILIKE $1 OR ce.destination ILIKE $1';
    query += searchCondition;
    countQuery += searchCondition;
    params.push(`%${search}%`);
  }

  query += groupBy + ` ORDER BY ce.${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limitNum, offset);

  const [result, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, search ? [`%${search}%`] : [])
  ]);

  const total = parseInt(countResult.rows[0].count);
  const totalPages = Math.ceil(total / limitNum);

  res.json({
    data: result.rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasNext: pageNum < totalPages,
      hasPrev: pageNum > 1
    }
  });
}));

// ===== READ - Un créneau par ID =====
creneauxRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query(
    `SELECT ce.*, 
            COUNT(c.id) as nombre_colis_actuels,
            (ce.capacite_max - COUNT(c.id)) as places_restantes
     FROM creneaux_expedition ce
     LEFT JOIN colis c ON ce.id = c.creneau_id
     WHERE ce.id = $1
     GROUP BY ce.id`,
    [id]
  );
  
  if (result.rows.length === 0) return res.status(404).json({ error: 'Créneau non trouvé' });

  res.json(result.rows[0]);
}));

// ===== UPDATE - Modifier un créneau complet =====
creneauxRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  
  // Validation des champs obligatoires
  const requiredFields = ['heure_depart', 'lieu_depart', 'destination', 'capacite_max', 'frais_par_kg', 'poids_max_colis', 'date_expedition'];
  for (let field of requiredFields) {
    if (!updates[field]) return res.status(400).json({ error: `Champ obligatoire manquant: ${field}` });
  }

  // Validation du type de transport
  const validTransportTypes = ['standard', 'express', 'prioritaire'];
  if (updates.type_transport && !validTransportTypes.includes(updates.type_transport)) {
    return res.status(400).json({ error: 'Type de transport invalide. Doit être: standard, express ou prioritaire' });
  }

  // Validation des nombres positifs
  if (updates.capacite_max <= 0 || updates.frais_par_kg <= 0 || updates.poids_max_colis <= 0) {
    return res.status(400).json({ error: 'La capacité, les frais et le poids maximum doivent être supérieurs à 0' });
  }

  const result = await pool.query(
    `UPDATE creneaux_expedition SET
    heure_depart = $1, lieu_depart = $2, destination = $3, capacite_max = $4, 
    frais_par_kg = $5, poids_max_colis = $6, type_transport = $7, date_expedition = $8
    WHERE id = $9 RETURNING *`,
    [
      updates.heure_depart,
      updates.lieu_depart,
      updates.destination,
      updates.capacite_max,
      updates.frais_par_kg,
      updates.poids_max_colis,
      updates.type_transport,
      updates.date_expedition,
      id
    ]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Créneau non trouvé' });

  res.json(result.rows[0]);
}));

// ===== PATCH - Modification partielle =====
creneauxRouter.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  if (!updates || Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

  const allowedFields = ['heure_depart', 'lieu_depart', 'destination', 'capacite_max', 
                        'frais_par_kg', 'poids_max_colis', 'type_transport', 'date_expedition'];
  const fieldsToUpdate = Object.keys(updates).filter(f => allowedFields.includes(f));
  
  if (fieldsToUpdate.length === 0) return res.status(400).json({ error: 'Aucun champ valide à modifier' });

  // Validation spécifique si type_transport est modifié
  if (updates.type_transport) {
    const validTransportTypes = ['standard', 'express', 'prioritaire'];
    if (!validTransportTypes.includes(updates.type_transport)) {
      return res.status(400).json({ error: 'Type de transport invalide. Doit être: standard, express ou prioritaire' });
    }
  }

  // Validation des nombres positifs
  if ((updates.capacite_max && updates.capacite_max <= 0) ||
      (updates.frais_par_kg && updates.frais_par_kg <= 0) ||
      (updates.poids_max_colis && updates.poids_max_colis <= 0)) {
    return res.status(400).json({ error: 'La capacité, les frais et le poids maximum doivent être supérieurs à 0' });
  }

  const setClause = fieldsToUpdate.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = fieldsToUpdate.map(f => updates[f]);
  values.push(id);

  const result = await pool.query(
    `UPDATE creneaux_expedition SET ${setClause} WHERE id = $${values.length} RETURNING *`,
    values
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Créneau non trouvé' });

  res.json(result.rows[0]);
}));

// ===== DELETE - Supprimer un créneau =====
creneauxRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  // Vérifier s'il y a des colis associés
  const colisResult = await pool.query('SELECT COUNT(*) FROM colis WHERE creneau_id = $1', [id]);
  if (parseInt(colisResult.rows[0].count) > 0) {
    return res.status(400).json({ error: 'Impossible de supprimer le créneau: des colis y sont associés' });
  }

  const result = await pool.query('DELETE FROM creneaux_expedition WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Créneau non trouvé' });

  res.json({ message: 'Créneau supprimé', deletedCreneau: result.rows[0] });
}));

export default creneauxRouter;