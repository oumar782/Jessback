import { Router } from 'express';
import pool from '../db.js';
import dotenv from 'dotenv';

dotenv.config();

const reservationsRouter = Router();

// Middleware async pour gérer les erreurs
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===== COUNT - Nombre total de réservations =====
reservationsRouter.get('/count', asyncHandler(async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM reservations');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Error counting reservations:', error);
    res.status(500).json({ error: 'Erreur lors du comptage des réservations' });
  }
}));

// ===== CREATE - Ajouter une réservation =====
reservationsRouter.post('/', asyncHandler(async (req, res) => {
  const {
    destination,
    nom,
    prenom,
    email,
    telephone,
    lieu_depart,
    date_depart,
    date_retour,
    nombre_passagers,
    classe
  } = req.body;

  // Validation des champs obligatoires
  if (!destination || !nom || !prenom || !email || !telephone || 
      !lieu_depart || !date_depart || !nombre_passagers || !classe) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  // Validation de la classe
  const validClasses = ['Economique', 'Affaires', 'Premiere'];
  if (!validClasses.includes(classe)) {
    return res.status(400).json({ error: 'Classe invalide. Doit être: Economique, Affaires ou Premiere' });
  }

  // Validation du nombre de passagers
  if (nombre_passagers <= 0) {
    return res.status(400).json({ error: 'Le nombre de passagers doit être supérieur à 0' });
  }

  const result = await pool.query(
    `INSERT INTO reservations 
    (destination, nom, prenom, email, telephone, lieu_depart, 
     date_depart, date_retour, nombre_passagers, classe)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
    RETURNING *`,
    [
      destination, 
      nom, 
      prenom,
      email, 
      telephone,
      lieu_depart, 
      date_depart, 
      date_retour, 
      nombre_passagers, 
      classe
    ]
  );

  res.status(201).json(result.rows[0]);
}));

// ===== READ - Toutes les réservations =====
reservationsRouter.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, sortBy = 'id', order = 'DESC' } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const allowedSortColumns = ['id', 'nom', 'prenom', 'email', 'destination', 'date_depart', 'created_at'];
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
  const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  let query = 'SELECT * FROM reservations';
  let countQuery = 'SELECT COUNT(*) FROM reservations';
  const params = [];

  if (search) {
    const searchCondition = ' WHERE nom ILIKE $1 OR prenom ILIKE $1 OR email ILIKE $1 OR destination ILIKE $1';
    query += searchCondition;
    countQuery += searchCondition;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY ${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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

// ===== READ - Une réservation par ID =====
reservationsRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query('SELECT * FROM reservations WHERE id = $1', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Réservation non trouvée' });

  res.json(result.rows[0]);
}));

// ===== UPDATE - Modifier une réservation complète =====
reservationsRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  
  // Validation des champs obligatoires
  const requiredFields = ['destination', 'nom', 'prenom', 'email', 'telephone', 
                         'lieu_depart', 'date_depart', 'nombre_passagers', 'classe'];
  for (let field of requiredFields) {
    if (!updates[field]) return res.status(400).json({ error: `Champ obligatoire manquant: ${field}` });
  }

  // Validation de la classe
  const validClasses = ['Economique', 'Affaires', 'Premiere'];
  if (!validClasses.includes(updates.classe)) {
    return res.status(400).json({ error: 'Classe invalide. Doit être: Economique, Affaires ou Premiere' });
  }

  // Validation du nombre de passagers
  if (updates.nombre_passagers <= 0) {
    return res.status(400).json({ error: 'Le nombre de passagers doit être supérieur à 0' });
  }

  const result = await pool.query(
    `UPDATE reservations SET
    destination = $1, nom = $2, prenom = $3, email = $4, telephone = $5, 
    lieu_depart = $6, date_depart = $7, date_retour = $8, 
    nombre_passagers = $9, classe = $10
    WHERE id = $11 RETURNING *`,
    [
      updates.destination,
      updates.nom,
      updates.prenom,
      updates.email,
      updates.telephone,
      updates.lieu_depart,
      updates.date_depart,
      updates.date_retour,
      updates.nombre_passagers,
      updates.classe,
      id
    ]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Réservation non trouvée' });

  res.json(result.rows[0]);
}));

// ===== PATCH - Modification partielle =====
reservationsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  if (!updates || Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

  const allowedFields = ['destination', 'nom', 'prenom', 'email', 'telephone', 
                        'lieu_depart', 'date_depart', 'date_retour', 
                        'nombre_passagers', 'classe'];
  const fieldsToUpdate = Object.keys(updates).filter(f => allowedFields.includes(f));
  
  if (fieldsToUpdate.length === 0) return res.status(400).json({ error: 'Aucun champ valide à modifier' });

  // Validation spécifique si classe est modifiée
  if (updates.classe) {
    const validClasses = ['Economique', 'Affaires', 'Premiere'];
    if (!validClasses.includes(updates.classe)) {
      return res.status(400).json({ error: 'Classe invalide. Doit être: Economique, Affaires ou Premiere' });
    }
  }

  // Validation spécifique si nombre_passagers est modifié
  if (updates.nombre_passagers && updates.nombre_passagers <= 0) {
    return res.status(400).json({ error: 'Le nombre de passagers doit être supérieur à 0' });
  }

  const setClause = fieldsToUpdate.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = fieldsToUpdate.map(f => updates[f]);
  values.push(id);

  const result = await pool.query(
    `UPDATE reservations SET ${setClause} WHERE id = $${values.length} RETURNING *`,
    values
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Réservation non trouvée' });

  res.json(result.rows[0]);
}));

// ===== DELETE - Supprimer une réservation =====
reservationsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query('DELETE FROM reservations WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Réservation non trouvée' });

  res.json({ message: 'Réservation supprimée', deletedReservation: result.rows[0] });
}));

// ===== DELETE - Suppression multiple =====
reservationsRouter.delete('/', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Liste d\'IDs requise' });

  const validIds = ids.filter(id => !isNaN(parseInt(id)));
  if (validIds.length === 0) return res.status(400).json({ error: 'Aucun ID valide fourni' });

  const placeholders = validIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(
    `DELETE FROM reservations WHERE id IN (${placeholders}) RETURNING *`,
    validIds
  );

  res.json({ 
    message: `${result.rows.length} réservation(s) supprimée(s)`, 
    deletedReservations: result.rows 
  });
}));

// Middleware global pour erreurs
reservationsRouter.use((error, req, res, next) => {
  console.error('Erreur dans reservationsRouter:', error);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

export default reservationsRouter;