package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAuthResetURLUsesFrontendSetting(t *testing.T) {
	t.Setenv("GARUDA_DEMO_MODE", "true")
	t.Setenv("AUTH_RESET_URL", "https://app.example.com/auth/reset-password")
	t.Setenv("AUTH_VERIFY_URL", "https://app.example.com/auth/verify-email")
	t.Setenv("SENDGRID_API_KEY", "test-sendgrid-key")
	t.Setenv("SENDGRID_FROM_EMAIL", "no-reply@example.com")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_ANON_KEY", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthResetURL != "https://app.example.com/auth/reset-password" {
		t.Fatalf("unexpected reset URL %q", cfg.AuthResetURL)
	}
}

func TestExplicitEnvFileLoadsWithoutOverridingProcessEnvironment(t *testing.T) {
	workingDirectory := t.TempDir()
	previousDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(workingDirectory); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previousDirectory) })

	fileOnlyKey := "GARUDA_TEST_ENV_FILE_ONLY"
	processKey := "GARUDA_TEST_ENV_PROCESS_WINS"
	oldFileValue, hadFileValue := os.LookupEnv(fileOnlyKey)
	_ = os.Unsetenv(fileOnlyKey)
	t.Cleanup(func() {
		if hadFileValue {
			_ = os.Setenv(fileOnlyKey, oldFileValue)
		} else {
			_ = os.Unsetenv(fileOnlyKey)
		}
	})
	t.Setenv(processKey, "process")
	contents := fileOnlyKey + "='loaded safely'\n" + processKey + "=file\n"
	if err := os.WriteFile(filepath.Join(workingDirectory, ".env.test"), []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GARUDA_ENV_FILE", ".env.test")
	if err := loadExplicitEnvFile(); err != nil {
		t.Fatalf("loadExplicitEnvFile: %v", err)
	}
	if got := os.Getenv(fileOnlyKey); got != "loaded safely" {
		t.Fatalf("file value = %q", got)
	}
	if got := os.Getenv(processKey); got != "process" {
		t.Fatalf("process environment was overwritten: %q", got)
	}
}

func TestExplicitEnvFileCannotEscapeWorkingDirectory(t *testing.T) {
	root := t.TempDir()
	workingDirectory := filepath.Join(root, "work")
	if err := os.Mkdir(workingDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "outside.env"), []byte("SAFE_KEY=value\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	previousDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(workingDirectory); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previousDirectory) })
	t.Setenv("GARUDA_ENV_FILE", filepath.Join("..", "outside.env"))
	if err := loadExplicitEnvFile(); err == nil {
		t.Fatal("expected an escaping env file path to be rejected")
	}
}

func setProductionConfig(t *testing.T) {
	t.Helper()
	t.Setenv("GARUDA_DEMO_MODE", "false")
	t.Setenv("GARUDA_AUTH_MODE", "local")
	t.Setenv("GARUDA_JWT_SECRET", "production-jwt-secret-with-at-least-32-bytes")
	t.Setenv("GARUDA_VISITOR_HMAC_KEY", "separate-visitor-secret-with-at-least-32-bytes")
	t.Setenv("AUTH_RESET_URL", "https://app.example.com/auth/reset-password")
	t.Setenv("AUTH_VERIFY_URL", "https://app.example.com/auth/verify-email")
	t.Setenv("SENDGRID_API_KEY", "test-sendgrid-key")
	t.Setenv("SENDGRID_FROM_EMAIL", "no-reply@example.com")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_ANON_KEY", "")
	t.Setenv("STRIPE_SECRET_KEY", "")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "")
	t.Setenv("STRIPE_PRICE_ID", "")
	t.Setenv("STRIPE_PRICE_ID_STARTER_17", "")
}

func TestAuthModeSelectsLocalWithoutDiscardingSupabaseSettings(t *testing.T) {
	t.Setenv("GARUDA_DEMO_MODE", "true")
	t.Setenv("GARUDA_AUTH_MODE", "local")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")
	t.Setenv("SUPABASE_ANON_KEY", "anon-key")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthMode != "local" || cfg.SupabaseURL == "" {
		t.Fatalf("expected local auth with retained Supabase settings: %#v", cfg)
	}
}

func TestSupabaseAuthModeRequiresProviderConfiguration(t *testing.T) {
	t.Setenv("GARUDA_DEMO_MODE", "true")
	t.Setenv("GARUDA_AUTH_MODE", "supabase")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_ANON_KEY", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected missing Supabase auth configuration to be rejected")
	}
}

func TestProductionRejectsKnownDefaultAndSharedVisitorSecrets(t *testing.T) {
	setProductionConfig(t)
	t.Setenv("GARUDA_JWT_SECRET", defaultJWTSecret)
	if _, err := Load(); err == nil {
		t.Fatal("expected the known local JWT secret to be rejected outside demo mode")
	}

	setProductionConfig(t)
	shared := "one-shared-secret-with-at-least-thirty-two-bytes"
	t.Setenv("GARUDA_JWT_SECRET", shared)
	t.Setenv("GARUDA_VISITOR_HMAC_KEY", shared)
	if _, err := Load(); err == nil {
		t.Fatal("expected JWT and visitor HMAC secrets to be distinct outside demo mode")
	}
}

func TestProductionStripeConfigurationMustBeComplete(t *testing.T) {
	setProductionConfig(t)
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_configured")
	t.Setenv("STRIPE_PRICE_ID", "price_starter")
	if _, err := Load(); err == nil {
		t.Fatal("expected checkout configuration without a webhook secret to be rejected")
	}

	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_configured")
	if _, err := Load(); err != nil {
		t.Fatalf("expected complete Stripe configuration to load: %v", err)
	}
}
