package watchdog

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

// listenForNotifications stands in for systemd: a unixgram socket that records
// what the process sends it.
func listenForNotifications(t *testing.T) (*net.UnixConn, string, func() []string) {
	t.Helper()
	// A path socket rather than an abstract one, because abstract sockets are
	// Linux-only and this test has to pass on the machine it is written on.
	path := filepath.Join(t.TempDir(), "notify.sock")
	address, err := net.ResolveUnixAddr("unixgram", path)
	if err != nil {
		t.Skipf("unixgram is unavailable here: %v", err)
	}
	connection, err := net.ListenUnixgram("unixgram", address)
	if err != nil {
		t.Skipf("unixgram is unavailable here: %v", err)
	}
	t.Cleanup(func() { _ = connection.Close() })

	var received atomic.Value
	received.Store([]string{})
	go func() {
		buffer := make([]byte, 256)
		for {
			read, err := connection.Read(buffer)
			if err != nil {
				return
			}
			current := append([]string{}, received.Load().([]string)...)
			received.Store(append(current, string(buffer[:read])))
		}
	}()
	return connection, path, func() []string { return received.Load().([]string) }
}

func withEnvironment(t *testing.T, socket string, watchdogMicroseconds int64) {
	t.Helper()
	t.Setenv("NOTIFY_SOCKET", socket)
	t.Setenv("WATCHDOG_USEC", strconv.FormatInt(watchdogMicroseconds, 10))
	t.Setenv("WATCHDOG_PID", strconv.Itoa(os.Getpid()))
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// Outside systemd there is no socket, and the watchdog must be inert rather than
// half-configured. Every test run and every developer machine is this case.
func TestWithoutSystemdThereIsNoWatchdogAtAll(t *testing.T) {
	t.Setenv("NOTIFY_SOCKET", "")
	t.Setenv("WATCHDOG_USEC", "30000000")
	if New(func(context.Context) error { return nil }, quietLogger()) != nil {
		t.Fatal("a watchdog was created with no notification socket")
	}

	t.Setenv("NOTIFY_SOCKET", "/tmp/does-not-matter.sock")
	t.Setenv("WATCHDOG_USEC", "")
	if New(func(context.Context) error { return nil }, quietLogger()) != nil {
		t.Fatal("a watchdog was created with no watchdog interval")
	}

	// And a nil Notifier must be safe to drive, so the caller needs no branch.
	var absent *Notifier
	absent.Start()
	absent.Stop()
}

// A watchdog set on a service must not be honoured by a child process that
// merely inherited the environment.
func TestAWatchdogMeantForAnotherProcessIsIgnored(t *testing.T) {
	_, socket, _ := listenForNotifications(t)
	withEnvironment(t, socket, 30_000_000)
	t.Setenv("WATCHDOG_PID", strconv.Itoa(os.Getpid()+1))

	if New(func(context.Context) error { return nil }, quietLogger()) != nil {
		t.Fatal("a watchdog addressed to another pid was adopted")
	}
}

// The ping is not a timer. It goes out only after the probe has succeeded, which
// is the entire mechanism.
func TestAHealthyServicePingsAndAWedgedOneStops(t *testing.T) {
	_, socket, received := listenForNotifications(t)
	// 40ms watchdog, so the notifier pings every 20ms and the test is quick.
	withEnvironment(t, socket, 40_000)

	var healthy atomic.Bool
	healthy.Store(true)
	notifier := New(func(context.Context) error {
		if healthy.Load() {
			return nil
		}
		return errors.New("the store is wedged")
	}, quietLogger())
	if notifier == nil {
		t.Fatal("no watchdog was created from a complete environment")
	}

	notifier.Start()
	defer notifier.Stop()

	waitFor(t, time.Second, func() bool { return countOf(received(), "WATCHDOG=1") >= 3 })
	if countOf(received(), "READY=1") != 1 {
		t.Fatalf("READY was sent %d times, want exactly once", countOf(received(), "READY=1"))
	}

	// Now wedge it. The pings must stop, because withholding them is what makes
	// systemd restart a process that is alive and unable to serve.
	healthy.Store(false)
	settled := countOf(received(), "WATCHDOG=1")
	time.Sleep(150 * time.Millisecond)
	if grew := countOf(received(), "WATCHDOG=1") - settled; grew > 1 {
		t.Fatalf("a wedged service kept pinging: %d further pings", grew)
	}

	// And it recovers rather than staying silent for good.
	healthy.Store(true)
	before := countOf(received(), "WATCHDOG=1")
	waitFor(t, time.Second, func() bool { return countOf(received(), "WATCHDOG=1") > before })
}

// A probe that never returns is itself evidence the service is wedged. It must
// not block the goroutine that would otherwise have withheld the ping.
func TestAProbeThatHangsDoesNotHangTheWatchdog(t *testing.T) {
	_, socket, received := listenForNotifications(t)
	withEnvironment(t, socket, 40_000)

	notifier := New(func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}, quietLogger())
	notifier.Start()
	defer notifier.Stop()

	time.Sleep(200 * time.Millisecond)
	if pings := countOf(received(), "WATCHDOG=1"); pings != 0 {
		t.Fatalf("a hanging probe still produced %d pings", pings)
	}
	if countOf(received(), "READY=1") != 1 {
		t.Error("READY was not sent before the probe was ever run")
	}
}

// A deliberate shutdown must not be logged as a watchdog failure.
func TestStoppingIsAnnouncedSoACleanExitIsNotAFailure(t *testing.T) {
	_, socket, received := listenForNotifications(t)
	withEnvironment(t, socket, 40_000)

	notifier := New(func(context.Context) error { return nil }, quietLogger())
	notifier.Start()
	notifier.Stop()

	waitFor(t, time.Second, func() bool { return countOf(received(), "STOPPING=1") == 1 })
}

func countOf(messages []string, wanted string) int {
	total := 0
	for _, message := range messages {
		if message == wanted {
			total++
		}
	}
	return total
}

func waitFor(t *testing.T, limit time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the expected notifications never arrived")
}
