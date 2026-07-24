-- ============================================================
-- Patch nº 20 — Vinculación usuario ↔ ficha de médico ÚNICA
-- Una ficha de médico solo puede estar vinculada a UN usuario
-- del panel (y una vez vinculada, la API no permite cambiarla).
-- ============================================================

create unique index if not exists uq_usuarios_panel_medico
  on eivi.usuarios_panel(medico_id) where medico_id is not null;

notify pgrst, 'reload schema';
