// Em desenvolvimento o `ng serve` repassa /api e /hubs para o servidor .NET (proxy.conf.json),
// então as URLs são relativas e não precisam de CORS.
export const environment = {
  apiUrl: '/api',
  hubUrl: '/hubs/voice',
};
