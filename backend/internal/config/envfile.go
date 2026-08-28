package config

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const maxEnvFileBytes = 64 << 10

// loadExplicitEnvFile loads only the relative file explicitly named by
// GARUDA_ENV_FILE. Existing process environment variables always win. Garuda
// never searches for or silently loads a dotenv file in production.
func loadExplicitEnvFile() error {
	name := strings.TrimSpace(os.Getenv("GARUDA_ENV_FILE"))
	if name == "" {
		return nil
	}
	if filepath.IsAbs(name) {
		return fmt.Errorf("GARUDA_ENV_FILE must be a relative path inside the working directory")
	}
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("resolve GARUDA_ENV_FILE working directory: %w", err)
	}
	target := filepath.Join(cwd, filepath.Clean(name))
	resolvedRoot, err := filepath.EvalSymlinks(cwd)
	if err != nil {
		return fmt.Errorf("resolve GARUDA_ENV_FILE working directory: %w", err)
	}
	resolvedTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		return fmt.Errorf("open GARUDA_ENV_FILE: %w", err)
	}
	relative, err := filepath.Rel(resolvedRoot, resolvedTarget)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("GARUDA_ENV_FILE must stay inside the working directory")
	}
	info, err := os.Stat(resolvedTarget)
	if err != nil {
		return fmt.Errorf("stat GARUDA_ENV_FILE: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > maxEnvFileBytes {
		return fmt.Errorf("GARUDA_ENV_FILE must be a regular file no larger than %d bytes", maxEnvFileBytes)
	}
	file, err := os.Open(resolvedTarget)
	if err != nil {
		return fmt.Errorf("open GARUDA_ENV_FILE: %w", err)
	}
	defer file.Close()
	reader := io.LimitReader(file, maxEnvFileBytes+1)
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), maxEnvFileBytes+1)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "\ufeff"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || !validEnvKey(key) {
			return fmt.Errorf("GARUDA_ENV_FILE line %d is invalid", lineNumber)
		}
		parsed, err := parseEnvValue(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("GARUDA_ENV_FILE line %d is invalid: %w", lineNumber, err)
		}
		if _, exists := os.LookupEnv(key); !exists {
			if err := os.Setenv(key, parsed); err != nil {
				return fmt.Errorf("set GARUDA_ENV_FILE key on line %d: %w", lineNumber, err)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read GARUDA_ENV_FILE: %w", err)
	}
	return nil
}

func parseEnvValue(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if value[0] == '\'' {
		if len(value) < 2 || value[len(value)-1] != '\'' {
			return "", fmt.Errorf("unterminated quoted value")
		}
		return value[1 : len(value)-1], nil
	}
	if value[0] == '"' {
		if len(value) < 2 || value[len(value)-1] != '"' {
			return "", fmt.Errorf("unterminated quoted value")
		}
		parsed, err := strconv.Unquote(value)
		if err != nil {
			return "", fmt.Errorf("invalid quoted value")
		}
		return parsed, nil
	}
	return value, nil
}

func validEnvKey(key string) bool {
	if key == "" || !asciiLetter(key[0]) && key[0] != '_' {
		return false
	}
	for index := 1; index < len(key); index++ {
		character := key[index]
		if !asciiLetter(character) && (character < '0' || character > '9') && character != '_' {
			return false
		}
	}
	return true
}

func asciiLetter(character byte) bool {
	return character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z'
}
