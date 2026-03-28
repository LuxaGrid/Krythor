// ─── Krythor UI Locale Definitions ──────────────────────────────────────────

export type LocaleCode = 'en' | 'zh-CN' | 'zh-TW' | 'pt-BR' | 'de' | 'es';

export interface Locale {
  // Navigation / tabs
  nav_agents:        string;
  nav_models:        string;
  nav_memory:        string;
  nav_sessions:      string;
  nav_guard:         string;
  nav_settings:      string;
  nav_plugins:       string;
  nav_providers:     string;
  nav_tools:         string;
  nav_channels:      string;
  nav_devices:       string;
  nav_canvas:        string;
  // Common actions
  btn_save:          string;
  btn_cancel:        string;
  btn_delete:        string;
  btn_edit:          string;
  btn_add:           string;
  btn_refresh:       string;
  btn_close:         string;
  btn_confirm:       string;
  btn_back:          string;
  // Status
  status_online:     string;
  status_offline:    string;
  status_loading:    string;
  status_error:      string;
  status_ok:         string;
  // Generic
  label_name:        string;
  label_description: string;
  label_model:       string;
  label_provider:    string;
  label_enabled:     string;
  label_disabled:    string;
  label_unknown:     string;
  label_never:       string;
  label_search:      string;
  label_filter:      string;
  // Settings
  settings_language: string;
  settings_theme:    string;
  settings_timezone: string;
}

export const LOCALES: Record<LocaleCode, Locale> = {
  'en': {
    nav_agents: 'Agents', nav_models: 'Models', nav_memory: 'Memory',
    nav_sessions: 'Sessions', nav_guard: 'Guard', nav_settings: 'Settings',
    nav_plugins: 'Plugins', nav_providers: 'Providers', nav_tools: 'Tools',
    nav_channels: 'Channels', nav_devices: 'Devices', nav_canvas: 'Canvas',
    btn_save: 'Save', btn_cancel: 'Cancel', btn_delete: 'Delete', btn_edit: 'Edit',
    btn_add: 'Add', btn_refresh: 'Refresh', btn_close: 'Close', btn_confirm: 'Confirm', btn_back: 'Back',
    status_online: 'Online', status_offline: 'Offline', status_loading: 'Loading\u2026',
    status_error: 'Error', status_ok: 'OK',
    label_name: 'Name', label_description: 'Description', label_model: 'Model',
    label_provider: 'Provider', label_enabled: 'Enabled', label_disabled: 'Disabled',
    label_unknown: 'Unknown', label_never: 'Never', label_search: 'Search', label_filter: 'Filter',
    settings_language: 'Language', settings_theme: 'Theme', settings_timezone: 'Timezone',
  },
  'zh-CN': {
    nav_agents: '\u667a\u80fd\u4f53', nav_models: '\u6a21\u578b', nav_memory: '\u8bb0\u5fc6',
    nav_sessions: '\u4f1a\u8bdd', nav_guard: '\u9632\u62a4', nav_settings: '\u8bbe\u7f6e',
    nav_plugins: '\u63d2\u4ef6', nav_providers: '\u670d\u52a1\u5546', nav_tools: '\u5de5\u5177',
    nav_channels: '\u9891\u9053', nav_devices: '\u8bbe\u5907', nav_canvas: '\u753b\u677f',
    btn_save: '\u4fdd\u5b58', btn_cancel: '\u53d6\u6d88', btn_delete: '\u5220\u9664', btn_edit: '\u7f16\u8f91',
    btn_add: '\u6dfb\u52a0', btn_refresh: '\u5237\u65b0', btn_close: '\u5173\u95ed', btn_confirm: '\u786e\u8ba4', btn_back: '\u8fd4\u56de',
    status_online: '\u5728\u7ebf', status_offline: '\u79bb\u7ebf', status_loading: '\u52a0\u8f7d\u4e2d\u2026',
    status_error: '\u9519\u8bef', status_ok: '\u6b63\u5e38',
    label_name: '\u540d\u79f0', label_description: '\u63cf\u8ff0', label_model: '\u6a21\u578b',
    label_provider: '\u670d\u52a1\u5546', label_enabled: '\u5df2\u542f\u7528', label_disabled: '\u5df2\u7981\u7528',
    label_unknown: '\u672a\u77e5', label_never: '\u4ece\u672a', label_search: '\u641c\u7d22', label_filter: '\u7b5b\u9009',
    settings_language: '\u8bed\u8a00', settings_theme: '\u4e3b\u9898', settings_timezone: '\u65f6\u533a',
  },
  'zh-TW': {
    nav_agents: '\u4ee3\u7406', nav_models: '\u6a21\u578b', nav_memory: '\u8a18\u61b6',
    nav_sessions: '\u5de5\u4f5c\u968e\u6bb5', nav_guard: '\u9632\u8b77', nav_settings: '\u8a2d\u5b9a',
    nav_plugins: '\u5916\u639b', nav_providers: '\u4f9b\u61c9\u5546', nav_tools: '\u5de5\u5177',
    nav_channels: '\u983b\u9053', nav_devices: '\u88dd\u7f6e', nav_canvas: '\u756b\u677f',
    btn_save: '\u5132\u5b58', btn_cancel: '\u53d6\u6d88', btn_delete: '\u522a\u9664', btn_edit: '\u7de8\u8f2f',
    btn_add: '\u65b0\u589e', btn_refresh: '\u91cd\u65b0\u6574\u7406', btn_close: '\u95dc\u9589', btn_confirm: '\u78ba\u8a8d', btn_back: '\u8fd4\u56de',
    status_online: '\u7dda\u4e0a', status_offline: '\u96e2\u7dda', status_loading: '\u8f09\u5165\u4e2d\u2026',
    status_error: '\u932f\u8aa4', status_ok: '\u6b63\u5e38',
    label_name: '\u540d\u7a31', label_description: '\u63cf\u8ff0', label_model: '\u6a21\u578b',
    label_provider: '\u4f9b\u61c9\u5546', label_enabled: '\u5df2\u555f\u7528', label_disabled: '\u5df2\u505c\u7528',
    label_unknown: '\u672a\u77e5', label_never: '\u5f9e\u672a', label_search: '\u641c\u5c0b', label_filter: '\u7be9\u9078',
    settings_language: '\u8a9e\u8a00', settings_theme: '\u4f48\u666f\u4e3b\u984c', settings_timezone: '\u6642\u5340',
  },
  'pt-BR': {
    nav_agents: 'Agentes', nav_models: 'Modelos', nav_memory: 'Mem\u00f3ria',
    nav_sessions: 'Sess\u00f5es', nav_guard: 'Guarda', nav_settings: 'Configura\u00e7\u00f5es',
    nav_plugins: 'Plugins', nav_providers: 'Provedores', nav_tools: 'Ferramentas',
    nav_channels: 'Canais', nav_devices: 'Dispositivos', nav_canvas: 'Canvas',
    btn_save: 'Salvar', btn_cancel: 'Cancelar', btn_delete: 'Excluir', btn_edit: 'Editar',
    btn_add: 'Adicionar', btn_refresh: 'Atualizar', btn_close: 'Fechar', btn_confirm: 'Confirmar', btn_back: 'Voltar',
    status_online: 'Online', status_offline: 'Offline', status_loading: 'Carregando\u2026',
    status_error: 'Erro', status_ok: 'OK',
    label_name: 'Nome', label_description: 'Descri\u00e7\u00e3o', label_model: 'Modelo',
    label_provider: 'Provedor', label_enabled: 'Ativado', label_disabled: 'Desativado',
    label_unknown: 'Desconhecido', label_never: 'Nunca', label_search: 'Buscar', label_filter: 'Filtrar',
    settings_language: 'Idioma', settings_theme: 'Tema', settings_timezone: 'Fuso Hor\u00e1rio',
  },
  'de': {
    nav_agents: 'Agenten', nav_models: 'Modelle', nav_memory: 'Ged\u00e4chtnis',
    nav_sessions: 'Sitzungen', nav_guard: 'Sicherheit', nav_settings: 'Einstellungen',
    nav_plugins: 'Plugins', nav_providers: 'Anbieter', nav_tools: 'Werkzeuge',
    nav_channels: 'Kan\u00e4le', nav_devices: 'Ger\u00e4te', nav_canvas: 'Canvas',
    btn_save: 'Speichern', btn_cancel: 'Abbrechen', btn_delete: 'L\u00f6schen', btn_edit: 'Bearbeiten',
    btn_add: 'Hinzuf\u00fcgen', btn_refresh: 'Aktualisieren', btn_close: 'Schlie\u00dfen', btn_confirm: 'Best\u00e4tigen', btn_back: 'Zur\u00fcck',
    status_online: 'Online', status_offline: 'Offline', status_loading: 'Lade\u2026',
    status_error: 'Fehler', status_ok: 'OK',
    label_name: 'Name', label_description: 'Beschreibung', label_model: 'Modell',
    label_provider: 'Anbieter', label_enabled: 'Aktiviert', label_disabled: 'Deaktiviert',
    label_unknown: 'Unbekannt', label_never: 'Nie', label_search: 'Suchen', label_filter: 'Filtern',
    settings_language: 'Sprache', settings_theme: 'Design', settings_timezone: 'Zeitzone',
  },
  'es': {
    nav_agents: 'Agentes', nav_models: 'Modelos', nav_memory: 'Memoria',
    nav_sessions: 'Sesiones', nav_guard: 'Guardia', nav_settings: 'Configuraci\u00f3n',
    nav_plugins: 'Plugins', nav_providers: 'Proveedores', nav_tools: 'Herramientas',
    nav_channels: 'Canales', nav_devices: 'Dispositivos', nav_canvas: 'Lienzo',
    btn_save: 'Guardar', btn_cancel: 'Cancelar', btn_delete: 'Eliminar', btn_edit: 'Editar',
    btn_add: 'A\u00f1adir', btn_refresh: 'Actualizar', btn_close: 'Cerrar', btn_confirm: 'Confirmar', btn_back: 'Volver',
    status_online: 'En l\u00ednea', status_offline: 'Sin conexi\u00f3n', status_loading: 'Cargando\u2026',
    status_error: 'Error', status_ok: 'OK',
    label_name: 'Nombre', label_description: 'Descripci\u00f3n', label_model: 'Modelo',
    label_provider: 'Proveedor', label_enabled: 'Activado', label_disabled: 'Desactivado',
    label_unknown: 'Desconocido', label_never: 'Nunca', label_search: 'Buscar', label_filter: 'Filtrar',
    settings_language: 'Idioma', settings_theme: 'Tema', settings_timezone: 'Zona Horaria',
  },
};

export const LOCALE_NAMES: Record<LocaleCode, string> = {
  'en':    'English',
  'zh-CN': '\u7b80\u4f53\u4e2d\u6587',
  'zh-TW': '\u7e41\u9ad4\u4e2d\u6587',
  'pt-BR': 'Portugu\u00eas (Brasil)',
  'de':    'Deutsch',
  'es':    'Espa\u00f1ol',
};
