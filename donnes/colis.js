import { Router } from 'express';
import pool from '../db.js';
import dotenv from 'dotenv';

dotenv.config();

const colisRouter = Router();

// Middleware async pour gérer les erreurs
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===== COUNT - Nombre total de colis =====
colisRouter.get('/count', asyncHandler(async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM colis');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Error counting colis:', error);
    res.status(500).json({ error: 'Erreur lors du comptage des colis' });
  }
}));

// ===== CREATE - Ajouter un colis =====
colisRouter.post('/', asyncHandler(async (req, res) => {
  const {
    creneau_id,
    nom_expediteur,
    telephone_expediteur,
    adresse_expediteur,
    nom_destinataire,
    telephone_destinataire,
    adresse_destinataire,
    type_colis,
    poids,
    description,
    valeur_declaree,
    assurance,
    methode_paiement
  } = req.body;

  // Validation des champs obligatoires
  const requiredFields = ['nom_expediteur', 'telephone_expediteur', 'adresse_expediteur', 
                         'nom_destinataire', 'telephone_destinataire', 'adresse_destinataire', 'poids'];
  for (let field of requiredFields) {
    if (!req.body[field]) {
      return res.status(400).json({ error: `Champ obligatoire manquant: ${field}` });
    }
  }

  // Validation du type de colis
  const validPackageTypes = ['document', 'vetements', 'electronique', 'nourriture', 'autre'];
  if (type_colis && !validPackageTypes.includes(type_colis)) {
    return res.status(400).json({ error: 'Type de colis invalide' });
  }

  // Validation de la méthode de paiement
  const validPaymentMethods = ['especes', 'carte', 'virement', 'mobile'];
  if (methode_paiement && !validPaymentMethods.includes(methode_paiement)) {
    return res.status(400).json({ error: 'Méthode de paiement invalide' });
  }

  // Validation du poids positif
  if (poids <= 0) {
    return res.status(400).json({ error: 'Le poids doit être supérieur à 0' });
  }

  // Vérifier la capacité du créneau si spécifié
  if (creneau_id) {
    const creneauResult = await pool.query(
      `SELECT ce.capacite_max, COUNT(c.id) as current_usage 
       FROM creneaux_expedition ce 
       LEFT JOIN colis c ON ce.id = c.creneau_id 
       WHERE ce.id = $1 
       GROUP BY ce.id`,
      [creneau_id]
    );
    
    if (creneauResult.rows.length === 0) {
      return res.status(400).json({ error: 'Créneau spécifié introuvable' });
    }
    
    const { capacite_max, current_usage } = creneauResult.rows[0];
    if (current_usage >= capacite_max) {
      return res.status(400).json({ error: 'Le créneau a atteint sa capacité maximale' });
    }
  }

  // Générer un numéro de suivi unique
  const numero_suivi = 'COL' + Date.now() + Math.random().toString(36).substr(2, 9).toUpperCase();

  const result = await pool.query(
    `INSERT INTO colis 
    (creneau_id, numero_suivi, nom_expediteur, telephone_expediteur, adresse_expediteur, 
     nom_destinataire, telephone_destinataire, adresse_destinataire, type_colis, poids, 
     description, valeur_declaree, assurance, methode_paiement)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
    RETURNING *`,
    [
      creneau_id,
      numero_suivi,
      nom_expediteur,
      telephone_expediteur,
      adresse_expediteur,
      nom_destinataire,
      telephone_destinataire,
      adresse_destinataire,
      type_colis || 'document',
      poids,
      description,
      valeur_declaree || 0,
      assurance || false,
      methode_paiement || 'especes'
    ]
  );

  res.status(201).json(result.rows[0]);
}));

// ===== READ - Tous les colis =====
colisRouter.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, statut, sortBy = 'id', order = 'DESC' } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const allowedSortColumns = ['id', 'nom_expediteur', 'nom_destinataire', 'date_creation', 'statut', 'poids'];
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
  const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  let query = `
    SELECT c.*, ce.lieu_depart, ce.destination, ce.heure_depart, ce.date_expedition
    FROM colis c
    LEFT JOIN creneaux_expedition ce ON c.creneau_id = ce.id
  `;
  let countQuery = 'SELECT COUNT(*) FROM colis c';
  const params = [];
  let whereConditions = [];

  if (search) {
    whereConditions.push('(c.nom_expediteur ILIKE $1 OR c.nom_destinataire ILIKE $1 OR c.numero_suivi ILIKE $1)');
    params.push(`%${search}%`);
  }

  if (statut) {
    const validStatus = ['en_attente', 'en_transit', 'livre'];
    if (validStatus.includes(statut)) {
      whereConditions.push(`c.statut = $${params.length + 1}`);
      params.push(statut);
    }
  }

  if (whereConditions.length > 0) {
    const whereClause = ' WHERE ' + whereConditions.join(' AND ');
    query += whereClause;
    countQuery += whereClause;
  }

  query += ` ORDER BY c.${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limitNum, offset);

  const [result, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, params.slice(0, -2)) // Remove limit and offset for count
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

// ===== READ - Un colis par ID =====
colisRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query(
    `SELECT c.*, ce.lieu_depart, ce.destination, ce.heure_depart, ce.date_expedition
     FROM colis c
     LEFT JOIN creneaux_expedition ce ON c.creneau_id = ce.id
     WHERE c.id = $1`,
    [id]
  );
  
  if (result.rows.length === 0) return res.status(404).json({ error: 'Colis non trouvé' });

  res.json(result.rows[0]);
}));

// ===== READ - Un colis par numéro de suivi =====
colisRouter.get('/suivi/:numero_suivi', asyncHandler(async (req, res) => {
  const { numero_suivi } = req.params;
  if (!numero_suivi) return res.status(400).json({ error: 'Numéro de suivi requis' });

  const result = await pool.query(
    `SELECT c.*, ce.lieu_depart, ce.destination, ce.heure_depart, ce.date_expedition
     FROM colis c
     LEFT JOIN creneaux_expedition ce ON c.creneau_id = ce.id
     WHERE c.numero_suivi = $1`,
    [numero_suivi]
  );
  
  if (result.rows.length === 0) return res.status(404).json({ error: 'Colis non trouvé' });

  res.json(result.rows[0]);
}));

// ===== UPDATE - Modifier un colis complet =====
colisRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  
  // Validation des champs obligatoires
  const requiredFields = ['nom_expediteur', 'telephone_expediteur', 'adresse_expediteur', 
                         'nom_destinataire', 'telephone_destinataire', 'adresse_destinataire', 'poids'];
  for (let field of requiredFields) {
    if (!updates[field]) return res.status(400).json({ error: `Champ obligatoire manquant: ${field}` });
  }

  // Validation du type de colis
  const validPackageTypes = ['document', 'vetements', 'electronique', 'nourriture', 'autre'];
  if (updates.type_colis && !validPackageTypes.includes(updates.type_colis)) {
    return res.status(400).json({ error: 'Type de colis invalide' });
  }

  // Validation de la méthode de paiement
  const validPaymentMethods = ['especes', 'carte', 'virement', 'mobile'];
  if (updates.methode_paiement && !validPaymentMethods.includes(updates.methode_paiement)) {
    return res.status(400).json({ error: 'Méthode de paiement invalide' });
  }

  // Validation du poids positif
  if (updates.poids <= 0) {
    return res.status(400).json({ error: 'Le poids doit être supérieur à 0' });
  }

  // Validation du statut
  const validStatus = ['en_attente', 'en_transit', 'livre'];
  if (updates.statut && !validStatus.includes(updates.statut)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }

  const result = await pool.query(
    `UPDATE colis SET
    creneau_id = $1, nom_expediteur = $2, telephone_expediteur = $3, adresse_expediteur = $4, 
    nom_destinataire = $5, telephone_destinataire = $6, adresse_destinataire = $7, 
    type_colis = $8, poids = $9, description = $10, valeur_declaree = $11, 
    assurance = $12, methode_paiement = $13, statut = $14
    WHERE id = $15 RETURNING *`,
    [
      updates.creneau_id,
      updates.nom_expediteur,
      updates.telephone_expediteur,
      updates.adresse_expediteur,
      updates.nom_destinataire,
      updates.telephone_destinataire,
      updates.adresse_destinataire,
      updates.type_colis,
      updates.poids,
      updates.description,
      updates.valeur_declaree,
      updates.assurance,
      updates.methode_paiement,
      updates.statut || 'en_attente',
      id
    ]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Colis non trouvé' });

  res.json(result.rows[0]);
}));

// ===== PATCH - Modification partielle =====
colisRouter.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  if (!updates || Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

  const allowedFields = ['creneau_id', 'nom_expediteur', 'telephone_expediteur', 'adresse_expediteur', 
                        'nom_destinataire', 'telephone_destinataire', 'adresse_destinataire', 
                        'type_colis', 'poids', 'description', 'valeur_declaree', 
                        'assurance', 'methode_paiement', 'statut'];
  const fieldsToUpdate = Object.keys(updates).filter(f => allowedFields.includes(f));
  
  if (fieldsToUpdate.length === 0) return res.status(400).json({ error: 'Aucun champ valide à modifier' });

  // Validation spécifique si type_colis est modifié
  if (updates.type_colis) {
    const validPackageTypes = ['document', 'vetements', 'electronique', 'nourriture', 'autre'];
    if (!validPackageTypes.includes(updates.type_colis)) {
      return res.status(400).json({ error: 'Type de colis invalide' });
    }
  }

  // Validation spécifique si methode_paiement est modifié
  if (updates.methode_paiement) {
    const validPaymentMethods = ['especes', 'carte', 'virement', 'mobile'];
    if (!validPaymentMethods.includes(updates.methode_paiement)) {
      return res.status(400).json({ error: 'Méthode de paiement invalide' });
    }
  }

  // Validation spécifique si poids est modifié
  if (updates.poids && updates.poids <= 0) {
    return res.status(400).json({ error: 'Le poids doit être supérieur à 0' });
  }

  // Validation spécifique si statut est modifié
  if (updates.statut) {
    const validStatus = ['en_attente', 'en_transit', 'livre'];
    if (!validStatus.includes(updates.statut)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }
  }

  const setClause = fieldsToUpdate.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = fieldsToUpdate.map(f => updates[f]);
  values.push(id);

  const result = await pool.query(
    `UPDATE colis SET ${setClause} WHERE id = $${values.length} RETURNING *`,
    values
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Colis non trouvé' });

  res.json(result.rows[0]);
}));

// ===== DELETE - Supprimer un colis =====
colisRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query('DELETE FROM colis WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Colis non trouvé' });

  res.json({ message: 'Colis supprimé', deletedColis: result.rows[0] });
}));

export default colisRouter;