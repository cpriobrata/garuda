// Package watchdog proves to the init system that this process is not merely
// running but actually able to serve.
//
// THE GAP IT CLOSES. systemd already restarts the API when it exits, and it is
// configured to do so without limit. What it cannot see is a process that is
// alive and wedged: a deadlock on the store's mutex, a goroutine holding the
// write lock forever. The port stays open, the process stays up, and every
// request hangs. To systemd that is a healthy service, and it stays "healthy"
// until somebody notices.
//
// So the ping sent here is not a timer. It is only sent after a probe has
// actually acquired the store's read lock and let go again. A process that
// cannot do that stops pinging, systemd's WatchdogSec expires, and the service
// is killed and restarted -- which is the correct response to a deadlock and the
// only one available from inside a deadlocked process.
//
// IT DOES NOTHING WITHOUT systemd. No NOTIFY_SOCKET in the environment means no
// socket, no goroutine and no behaviour change, so a developer running the
// binary directly, and every test, are untouched.
package watchdog

import (
	"context"
	"log/slog"
	"net"
	"os"
	"strconv"
	"time"
)

// Probe reports whether the service can still do the thing it exists to do. It
// must return quickly and must not allocate much: it runs on a short interval
// forever.
type Probe func(ctx context.Context) error

type Notifier struct {
	socket   string
	interval time.Duration
	probe    Probe
	logger   *slog.Logger
	stop     chan struct{}
}

// New reads the environment systemd sets. It returns nil when this process was
// not started by a systemd unit with a watchdog, which is the common case
// outside production.
func New(probe Probe, logger *slog.Logger) *Notifier {
	socket := os.Getenv("NOTIFY_SOCKET")
	if socket == "" || probe == nil {
		return nil
	}
	// WATCHDOG_USEC is the deadline systemd will enforce. Pinging at half of it
	// is the documented convention: it leaves a whole interval of slack for a
	// slow probe or a scheduling delay before the service is killed.
	microseconds, err := strconv.ParseInt(os.Getenv("WATCHDOG_USEC"), 10, 64)
	if err != nil || microseconds <= 0 {
		return nil
	}
	// WATCHDOG_PID exists so that a watchdog set on a service is not accidentally
	// honoured by a child process that inherited the environment.
	if pid := os.Getenv("WATCHDOG_PID"); pid != "" {
		if wanted, err := strconv.Atoi(pid); err == nil && wanted != os.Getpid() {
			return nil
		}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Notifier{
		socket:   socket,
		interval: time.Duration(microseconds) * time.Microsecond / 2,
		probe:    probe,
		logger:   logger,
		stop:     make(chan struct{}),
	}
}

// Start sends READY=1 and then keeps the watchdog fed for as long as the probe
// succeeds. Calling it on a nil Notifier is a no-op, so the caller needs no
// branch.
func (n *Notifier) Start() {
	if n == nil {
		return
	}
	n.send("READY=1")
	go n.run()
}

func (n *Notifier) Stop() {
	if n == nil {
		return
	}
	// STOPPING=1 tells systemd this exit is deliberate, so a clean shutdown is
	// not logged as a watchdog failure.
	n.send("STOPPING=1")
	close(n.stop)
}

func (n *Notifier) run() {
	ticker := time.NewTicker(n.interval)
	defer ticker.Stop()
	for {
		select {
		case <-n.stop:
			return
		case <-ticker.C:
			// The probe gets less than one interval. A probe that has not
			// returned by then is itself evidence the service is wedged, and
			// waiting longer only delays the restart that will fix it.
			ctx, cancel := context.WithTimeout(context.Background(), n.interval*3/4)
			err := n.probe(ctx)
			cancel()
			if err != nil {
				// Deliberately NOT pinging is the whole mechanism. Logging it
				// gives an operator the reason afterwards, in the journal, which
				// survives the restart.
				n.logger.Error("liveness probe failed; withholding the watchdog ping", "error", err)
				continue
			}
			n.send("WATCHDOG=1")
		}
	}
}

// send writes one datagram. Every failure is silent by design: the notification
// socket is a best-effort channel to the init system, and a service that logged
// an error every time it could not reach it would fill a journal with a problem
// nobody can act on.
func (n *Notifier) send(message string) {
	// An abstract socket, which is what systemd usually provides, is named with a
	// leading NUL. systemd passes it as "@" and expects the client to translate.
	address := n.socket
	if len(address) > 0 && address[0] == '@' {
		address = "\x00" + address[1:]
	}
	connection, err := net.DialTimeout("unixgram", address, time.Second)
	if err != nil {
		return
	}
	defer func() { _ = connection.Close() }()
	_ = connection.SetWriteDeadline(time.Now().Add(time.Second))
	_, _ = connection.Write([]byte(message))
}
