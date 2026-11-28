// Em produção, aponte para onde o PatoQuack.Server estiver publicado (e libere a origem do
// front em Cors:AllowedOrigins no appsettings do servidor). Relativo = mesmo host.
export const environment = {
  apiUrl: '/api',
  hubUrl: '/hubs/voice',
};
