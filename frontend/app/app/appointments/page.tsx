import { AppointmentsBoard } from "@/components/appointments/appointments-board";

export default function AppointmentsPage() {
  return (
    <div className="mx-auto max-w-[1120px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-[-.035em] text-slate-950">Appointments</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Every appointment your agents booked, soonest first, with the conversation that led to it and the calendar it
          landed in.
        </p>
      </div>
      <AppointmentsBoard />
    </div>
  );
}
