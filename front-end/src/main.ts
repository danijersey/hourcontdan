import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { bootstrapApplication } from '@angular/platform-browser';

type Role = 'admin' | 'manager' | 'employee';
type Employee = { id: number; name: string; email: string; role: Role };
type Task = { id: number; name: string; title: string; status: string };
type Dashboard = {
  user: Pick<Employee, 'id' | 'name' | 'role'>;
  employees: Employee[];
  attendance: { id: number; employee_id: number; name: string; started_at: string; ended_at: string | null; minutes: number | null }[];
  tasks: Task[];
  report: { id: number; name: string; minutes: number; completed: number; total: number }[];
  notifications: { id: number; message: string; read_at: string | null }[];
};

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
})
class App {
  data = signal<Dashboard | null>(null);
  error = signal('');
  busy = signal(false);
  section = signal('Resumen');
  token = sessionStorage.getItem('hourcontdan') ?? '';
  email = '';
  password = '';
  newEmployee = { name: '', email: '', role: 'employee', password: '' };
  newTask = { title: '', employeeId: 0 };
  labels = { admin: 'Administrador', manager: 'Gerente', employee: 'Empleado' };
  statuses = [{ value: 'pending', label: 'Pendiente' }, { value: 'doing', label: 'En curso' }, { value: 'done', label: 'Completada' }];
  sections = ['Resumen', 'Empleados', 'Asistencia', 'Tareas', 'Informes', 'Notificaciones'];
  editingId = 0;
  editedName = '';

  constructor() { if (this.token) void this.run(() => this.load()); }
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch('/api/' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (response.status === 401 && this.token) this.clearSession();
    if (!response.ok) throw new Error(response.status >= 500 ? 'No se pudo acceder al servidor o a la base de datos.' : result.message);
    return result;
  }
  async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try { await action(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Ocurrió un error.'); }
    finally { this.busy.set(false); }
  }
  async load() { this.data.set(await this.request<Dashboard>('dashboard')); }
  login() {
    return this.run(async () => {
      this.token = (await this.request<{ token: string }>('login', 'POST', { email: this.email, password: this.password })).token;
      sessionStorage.setItem('hourcontdan', this.token);
      this.password = '';
      await this.load();
    });
  }
  clearSession() {
    this.token = '';
    sessionStorage.removeItem('hourcontdan');
    this.data.set(null);
    this.section.set('Resumen');
  }
  logout() { return this.run(async () => { try { await this.request('logout', 'POST'); } finally { this.clearSession(); } }); }
  mutate(path: string, method: string, body?: unknown, after?: () => void) {
    return this.run(async () => { await this.request(path, method, body); after?.(); await this.load(); });
  }
  createEmployee() {
    return this.mutate('employees', 'POST', this.newEmployee, () => {
      this.newEmployee = { name: '', email: '', role: 'employee', password: '' };
    });
  }
  createTask() {
    return this.mutate('tasks', 'POST', this.newTask, () => { this.newTask = { title: '', employeeId: 0 }; });
  }
  edit(employee: Employee) { this.editingId = employee.id; this.editedName = employee.name; }
  save() {
    return this.mutate('employees/' + this.editingId, 'PATCH', { name: this.editedName }, () => { this.editingId = 0; });
  }
  openShift(d: Dashboard) { return d.attendance.some(a => a.employee_id === d.user.id && !a.ended_at); }
  unread(d: Dashboard) { return d.notifications.filter(n => !n.read_at).length; }
  completed(d: Dashboard) { return d.tasks.filter(t => t.status === 'done').length; }
  duration(minutes: number | null) {
    if (minutes === null) return 'En curso';
    return Math.floor(Number(minutes) / 60) + ' h ' + Number(minutes) % 60 + ' min';
  }
  date(value: string | null) {
    return value ? new Date(value.replace(' ', 'T') + 'Z').toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }
}
void bootstrapApplication(App);
