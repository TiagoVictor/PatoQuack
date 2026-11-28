// Contratos de /api/auth (espelham PatoQuack.Server/Api/AuthContracts.cs).

export interface UserDto {
  id: string;
  name: string;
  email: string;
  username: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  username: string;
  password: string;
}
