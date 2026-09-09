using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Npgsql;
using SuperShopper.Models;

namespace SuperShopper.Services
{
    public class PostgresService
    {
        private static readonly Dictionary<string, string> _envVars = new();

        public static string LocalConnectionString => GetEnv("POSTGRES_LOCAL_CONN", "Host=localhost;Port=5432;Database=supershopper_local;Username=postgres;Password=postgres");
        public static string ProductionConnectionString => GetEnv("POSTGRES_PROD_CONN", "Host=production-db.example.com;Port=5432;Database=supershopper_prod;Username=admin;Password=secret");
        public static string ActiveTargetEnv => GetEnv("POSTGRES_ACTIVE_TARGET", "local"); // "local" or "production"

        static PostgresService()
        {
            LoadEnvFile();
        }

        public static void LoadEnvFile()
        {
            try
            {
                // Search for .env file in base execution directory or project parent directory
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string envPath = Path.Combine(baseDir, ".env");

                if (!File.Exists(envPath))
                {
                    // Check parent directory
                    string parentPath = Path.Combine(baseDir, "..", "..", "..", ".env");
                    if (File.Exists(parentPath))
                    {
                        envPath = parentPath;
                    }
                }

                if (File.Exists(envPath))
                {
                    var lines = File.ReadAllLines(envPath);
                    foreach (var line in lines)
                    {
                        if (string.IsNullOrWhiteSpace(line) || line.TrimStart().StartsWith("#"))
                            continue;

                        var parts = line.Split('=', 2);
                        if (parts.Length == 2)
                        {
                            string key = parts[0].Trim();
                            string value = parts[1].Trim().Trim('"', '\'');
                            _envVars[key] = value;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to parse .env file: {ex.Message}");
            }
        }

        public static string GetEnv(string key, string defaultValue = "")
        {
            if (_envVars.TryGetValue(key, out var val) && !string.IsNullOrWhiteSpace(val))
            {
                return val;
            }

            var sysEnv = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrWhiteSpace(sysEnv))
            {
                return sysEnv;
            }

            return defaultValue;
        }

        public static string GetActiveConnectionString()
        {
            return ActiveTargetEnv.Equals("production", StringComparison.OrdinalIgnoreCase)
                ? ProductionConnectionString
                : LocalConnectionString;
        }

        public static NpgsqlConnection CreateConnection(string? connectionString = null)
        {
            string connStr = connectionString ?? GetActiveConnectionString();
            return new NpgsqlConnection(connStr);
        }

        /// <summary>
        /// SQL Helper to sync extracted deals to PostgreSQL (Invoked at runtime by user action).
        /// </summary>
        public static async Task<int> SaveDealsAsync(IEnumerable<ExtractedDealModel> deals, string? connectionString = null)
        {
            using var conn = CreateConnection(connectionString);
            await conn.OpenAsync();

            string createTableSql = @"
                CREATE TABLE IF NOT EXISTS extracted_deals (
                    id SERIAL PRIMARY KEY,
                    title TEXT NOT NULL UNIQUE,
                    deal_type TEXT,
                    price_info TEXT,
                    category TEXT,
                    valid_dates TEXT,
                    store_name TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );";

            using (var cmd = new NpgsqlCommand(createTableSql, conn))
            {
                await cmd.ExecuteNonQueryAsync();
            }

            int count = 0;
            string insertSql = @"
                INSERT INTO extracted_deals (title, deal_type, price_info, category, valid_dates, store_name)
                VALUES (@title, @deal_type, @price_info, @category, @valid_dates, @store_name)
                ON CONFLICT (title) DO UPDATE SET 
                    deal_type = EXCLUDED.deal_type,
                    price_info = EXCLUDED.price_info,
                    category = EXCLUDED.category,
                    valid_dates = EXCLUDED.valid_dates,
                    store_name = EXCLUDED.store_name;";

            foreach (var deal in deals)
            {
                using var cmd = new NpgsqlCommand(insertSql, conn);
                cmd.Parameters.AddWithValue("title", deal.Title);
                cmd.Parameters.AddWithValue("deal_type", deal.DealType ?? "");
                cmd.Parameters.AddWithValue("price_info", deal.PriceInfo ?? "");
                cmd.Parameters.AddWithValue("category", deal.Category ?? "");
                cmd.Parameters.AddWithValue("valid_dates", deal.ValidDates ?? "");
                cmd.Parameters.AddWithValue("store_name", deal.StoreName ?? "");

                await cmd.ExecuteNonQueryAsync();
                count++;
            }

            return count;
        }
    }
}
