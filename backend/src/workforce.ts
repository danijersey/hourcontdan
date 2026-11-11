import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, ParseIntPipe, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createPool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

const db = createPool({
  host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root', password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'hourcontdan', dateStrings: true,
});
type Role = 'admin' | 'manager' | 'employee';
interface Employee extends RowDataPacket { id: number; name: string; email: string; role: Role; password_hash: string }
const sessions = new Map<string, { id: number; expires: number }>();
const roles = ['admin', 'manager', 'employee'];

function hash(password: string, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
function required(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException('Revisa los campos requeridos.');
  return value.trim();
}
async function employee(id: number) {
  const [rows] = await db.execute<Employee[]>('SELECT * FROM employees WHERE id = ?', [id]);
  return rows[0];
}
async function authorize(header?: string) {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    throw new UnauthorizedException('Inicia sesión.');
  }
  const user = await employee(session.id);
  if (!user) throw new UnauthorizedException();
  return user;
}
function elevated(user: Employee) {
  if (user.role === 'employee') throw new ForbiddenException();
}

@Controller('api')
export class WorkforceController {
  @Post('login')
  async login(@Body() body: Record<string, unknown>) {
    const email = required(body.email, 160).toLowerCase();
    const password = required(body.password, 128);
    const [rows] = await db.execute<Employee[]>('SELECT * FROM employees WHERE email = ?', [email]);
    const user = rows[0];
    if (!user || !timingSafeEqual(Buffer.from(hash(password, user.password_hash.split(':')[0])), Buffer.from(user.password_hash))) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    const token = randomBytes(32).toString('hex');
    for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
    sessions.set(token, { id: user.id, expires: Date.now() + 8 * 3600000 });
    return { token };
  }

  @Post('logout')
  logout(@Headers('authorization') header?: string) {
    if (header?.startsWith('Bearer ')) sessions.delete(header.slice(7));
    return { ok: true };
  }

  @Get('dashboard')
  async dashboard(@Headers('authorization') header?: string) {
    const user = await authorize(header);
    const personal = user.role === 'employee';
    const scope = personal ? [user.id] : [];
    const [employees] = await db.execute('SELECT id, name, email, role FROM employees' + (personal ? ' WHERE id = ?' : '') + ' ORDER BY name', scope);
    const [attendance] = await db.execute('SELECT a.id, a.employee_id, e.name, a.started_at, a.ended_at, TIMESTAMPDIFF(MINUTE, a.started_at, a.ended_at) AS minutes FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE (a.started_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY OR a.ended_at IS NULL)' + (personal ? ' AND a.employee_id = ?' : '') + ' ORDER BY a.started_at DESC', scope);
    const [tasks] = await db.execute('SELECT t.*, e.name FROM tasks t JOIN employees e ON e.id = t.employee_id' + (personal ? ' WHERE t.employee_id = ?' : '') + ' ORDER BY t.id DESC', scope);
    const [notifications] = await db.execute('SELECT id, message, created_at, read_at FROM notifications WHERE employee_id = ? ORDER BY id DESC LIMIT 30', [user.id]);
    const [report] = await db.execute(`SELECT e.id, e.name, COALESCE(a.minutes, 0) AS minutes, COALESCE(t.completed, 0) AS completed, COALESCE(t.total, 0) AS total
      FROM employees e LEFT JOIN (
        SELECT employee_id, SUM(TIMESTAMPDIFF(MINUTE, started_at, ended_at)) AS minutes FROM attendance
        WHERE started_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY AND ended_at IS NOT NULL GROUP BY employee_id
      ) a ON a.employee_id = e.id LEFT JOIN (
        SELECT employee_id, SUM(status = 'done') AS completed, COUNT(*) AS total FROM tasks GROUP BY employee_id
      ) t ON t.employee_id = e.id` + (personal ? ' WHERE e.id = ?' : '') + ' ORDER BY e.name', scope);
    return { user: { id: user.id, name: user.name, role: user.role }, employees, attendance, tasks, notifications, report };
  }

  @Post('employees')
  async createEmployee(@Headers('authorization') header: string, @Body() body: Record<string, unknown>) {
    const user = await authorize(header);
    if (user.role !== 'admin') throw new ForbiddenException();
    const name = required(body.name, 100);
    const email = required(body.email, 160).toLowerCase();
    const role = required(body.role, 12);
    const password = required(body.password, 128);
    if (!roles.includes(role) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) throw new BadRequestException('Indica un correo válido, un rol y al menos 10 caracteres de contraseña.');
    try {
      await db.execute('INSERT INTO employees (name, email, role, password_hash) VALUES (?, ?, ?, ?)', [name, email, role, hash(password)]);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new BadRequestException('El correo ya está registrado.');
      throw error;
    }
    return { ok: true };
  }

  @Patch('employees/:id')
  async renameEmployee(@Headers('authorization') header: string, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const user = await authorize(header);
    if (user.role !== 'admin') throw new ForbiddenException();
    const name = required(body.name, 100);
    const [result] = await db.execute<ResultSetHeader>('UPDATE employees SET name = ? WHERE id = ?', [name, id]);
    if (!result.affectedRows) throw new BadRequestException('El empleado no existe.');
    return { ok: true };
  }

  @Post('attendance')
  async punch(@Headers('authorization') header: string, @Body() body: Record<string, unknown>) {
    const user = await authorize(header);
    if (body.action === 'in') {
      try {
        await db.execute('INSERT INTO attendance (employee_id, started_at) VALUES (?, UTC_TIMESTAMP())', [user.id]);
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new BadRequestException('Ya tienes una jornada abierta.');
        throw error;
      }
    } else if (body.action === 'out') {
      const [result] = await db.execute<ResultSetHeader>('UPDATE attendance SET ended_at = UTC_TIMESTAMP() WHERE employee_id = ? AND ended_at IS NULL', [user.id]);
      if (!result.affectedRows) throw new BadRequestException('Primero registra la entrada.');
    } else throw new BadRequestException('Marcación inválida.');
    return { ok: true };
  }

  @Post('tasks')
  async createTask(@Headers('authorization') header: string, @Body() body: Record<string, unknown>) {
    const user = await authorize(header);
    elevated(user);
    const title = required(body.title, 140);
    const employeeId = Number(body.employeeId);
    if (!Number.isSafeInteger(employeeId) || !(await employee(employeeId))) throw new BadRequestException('Selecciona un empleado.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('INSERT INTO tasks (employee_id, title) VALUES (?, ?)', [employeeId, title]);
      await connection.execute('INSERT INTO notifications (employee_id, message, created_at) VALUES (?, ?, UTC_TIMESTAMP())', [employeeId, 'Nueva tarea: ' + title]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
    return { ok: true };
  }

  @Patch('tasks/:id')
  async updateTask(@Headers('authorization') header: string, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const user = await authorize(header);
    const status = required(body.status, 16);
    if (!['pending', 'doing', 'done'].includes(status)) throw new BadRequestException('Estado inválido.');
    const personal = user.role === 'employee';
    const [result] = await db.execute<ResultSetHeader>('UPDATE tasks SET status = ? WHERE id = ?' + (personal ? ' AND employee_id = ?' : ''), personal ? [status, id, user.id] : [status, id]);
    if (!result.affectedRows) throw new BadRequestException('Tarea no disponible.');
    return { ok: true };
  }

  @Patch('notifications/:id')
  async readNotification(@Headers('authorization') header: string, @Param('id', ParseIntPipe) id: number) {
    const user = await authorize(header);
    await db.execute('UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE id = ? AND employee_id = ?', [id, user.id]);
    return { ok: true };
  }
}
