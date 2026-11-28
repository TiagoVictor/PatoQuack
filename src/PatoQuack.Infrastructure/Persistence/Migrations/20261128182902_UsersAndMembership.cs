using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PatoQuack.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UsersAndMembership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Servidores criados antes do login não têm dono, e a FK nova exige um. Eram só dados de
            // teste: apaga a presença e os servidores (canais vão junto pelo cascade).
            migrationBuilder.Sql("DELETE FROM participants;");
            migrationBuilder.Sql("DELETE FROM servers;");

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "servers",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "user_id",
                table: "participants",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    username = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    password_hash = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "server_members",
                columns: table => new
                {
                    server_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    joined_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_server_members", x => new { x.server_id, x.user_id });
                    table.ForeignKey(
                        name: "FK_server_members_servers_server_id",
                        column: x => x.server_id,
                        principalTable: "servers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_server_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_servers_owner_id",
                table: "servers",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "IX_participants_user_id",
                table: "participants",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_server_members_user_id",
                table: "server_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_users_email",
                table: "users",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_username",
                table: "users",
                column: "username",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_participants_users_user_id",
                table: "participants",
                column: "user_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_servers_users_owner_id",
                table: "servers",
                column: "owner_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM participants;");

            migrationBuilder.DropForeignKey(
                name: "FK_participants_users_user_id",
                table: "participants");

            migrationBuilder.DropForeignKey(
                name: "FK_servers_users_owner_id",
                table: "servers");

            migrationBuilder.DropTable(
                name: "server_members");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropIndex(
                name: "IX_servers_owner_id",
                table: "servers");

            migrationBuilder.DropIndex(
                name: "IX_participants_user_id",
                table: "participants");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "servers");

            migrationBuilder.DropColumn(
                name: "user_id",
                table: "participants");
        }
    }
}
