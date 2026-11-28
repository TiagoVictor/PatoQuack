using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PatoQuack.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ServerInvites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {


            migrationBuilder.CreateTable(
                name: "server_invites",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    server_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    max_uses = table.Column<int>(type: "integer", nullable: true),
                    uses = table.Column<int>(type: "integer", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_server_invites", x => x.id);
                    table.ForeignKey(
                        name: "FK_server_invites_servers_server_id",
                        column: x => x.server_id,
                        principalTable: "servers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_server_invites_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_server_invites_code",
                table: "server_invites",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_server_invites_created_by_id",
                table: "server_invites",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "IX_server_invites_server_id",
                table: "server_invites",
                column: "server_id");

            // Os códigos de convite que já existiam viram convites sem validade e sem limite de
            // usos: links já enviados continuam funcionando.
            migrationBuilder.Sql(
                "INSERT INTO server_invites (id, server_id, code, created_by_id, created_at, expires_at, max_uses, uses, revoked_at) " +
                "SELECT gen_random_uuid(), id, trim(invite_code), owner_id, created_at, NULL, NULL, 0, NULL FROM servers;");

            migrationBuilder.DropIndex(
                name: "IX_servers_invite_code",
                table: "servers");

            migrationBuilder.DropColumn(
                name: "invite_code",
                table: "servers");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "invite_code",
                table: "servers",
                type: "character(8)",
                fixedLength: true,
                maxLength: 8,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql(
                "UPDATE servers s SET invite_code = COALESCE((SELECT left(i.code, 8) FROM server_invites i " +
                "WHERE i.server_id = s.id ORDER BY i.created_at LIMIT 1), left(replace(s.id::text, '-', ''), 8));");

            migrationBuilder.CreateIndex(
                name: "IX_servers_invite_code",
                table: "servers",
                column: "invite_code",
                unique: true);

            migrationBuilder.DropTable(
                name: "server_invites");
        }
    }
}
