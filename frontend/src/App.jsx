// frontend/src/App.jsx
import React, { useState, useMemo } from 'react';
import { 
  Upload, FileSpreadsheet, Camera, Search, Layers, FileText, 
  UserCheck, ShieldCheck, CheckCircle2, Sparkles, Edit3, Trash2, 
  X, Filter, Download, Save, Calendar, Clock, ChevronRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function App() {
  const [xmlRecords, setXmlRecords] = useState([]);
  const [ineData, setIneData] = useState({ curp: '', claveElector: '', nombreBeneficiario: '' });
  const [loadingXml, setLoadingXml] = useState(false);
  const [loadingIne, setLoadingIne] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Estado para Edición
  const [editingRecord, setEditingRecord] = useState(null);

  // Estado para Opciones de Exportación
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportOption, setExportOption] = useState('all'); 
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  // Estado para Vista de Calendario por Mes
  const [selectedMonthModal, setSelectedMonthModal] = useState(null); 
  const [selectedDayDetails, setSelectedDayDetails] = useState(null); 

  // Función auxiliar para parsear fechas de forma segura sin desfasar zonas horarias
  const parseLocalDate = (dateStr) => {
    if (!dateStr) return null;
    const cleanStr = dateStr.toString().trim();
    // Si la fecha viene como ISO string "2026-11-05T..." o "2026-11-05"
    const match = cleanStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 0-indexed
      const day = parseInt(match[3], 10);
      return new Date(year, month, day);
    }
    const d = new Date(cleanStr);
    return isNaN(d.getTime()) ? null : d;
  };

  // 1. Carga XML
  const handleXmlUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoadingXml(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('xmlFiles', files[i]);
    }

    try {
      const response = await fetch('http://localhost:5000/api/xml/parse', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        setXmlRecords((prev) => [...prev, ...result.data]);
      }
    } catch (err) {
      alert('Asegúrate de que el servidor Backend (server.js) esté corriendo en el puerto 5000');
    } finally {
      setLoadingXml(false);
    }
  };

  // 2. OCR INE
  const handleIneScan = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoadingIne(true);
    const formData = new FormData();
    formData.append('ineImage', file);

    try {
      const response = await fetch('http://localhost:5000/api/ine/scan', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        setIneData((prev) => ({
          ...prev,
          curp: result.ineData.curp,
          claveElector: result.ineData.claveElector,
        }));
      }
    } catch (err) {
      alert('Error de conexión con el módulo OCR de INE.');
    } finally {
      setLoadingIne(false);
    }
  };

  // 3. Modificación y Borrado
  const handleDeleteRecord = (id) => {
    if (window.confirm('¿Está seguro de eliminar este comprobante de la lista?')) {
      setXmlRecords(prev => prev.filter(item => item.id !== id));
    }
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    setXmlRecords(prev => prev.map(item => item.id === editingRecord.id ? editingRecord : item));
    setEditingRecord(null);
  };

  // 4. Agrupación y Cálculo Mensual según la fecha extraída de la factura
  const monthlySummary = useMemo(() => {
    const summary = {};
    xmlRecords.forEach(record => {
      const dateObj = parseLocalDate(record.fecha);
      const isValidDate = dateObj !== null;
      
      const monthYearKey = isValidDate 
        ? `${dateObj.getFullYear()}-${dateObj.getMonth()}`
        : 'sin-fecha';

      const monthName = isValidDate
        ? dateObj.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
        : 'Sin Fecha';
      
      const formattedName = monthName.charAt(0).toUpperCase() + monthName.slice(1);

      if (!summary[monthYearKey]) {
        summary[monthYearKey] = { 
          key: monthYearKey,
          name: formattedName,
          year: isValidDate ? dateObj.getFullYear() : new Date().getFullYear(),
          monthIndex: isValidDate ? dateObj.getMonth() : 0,
          count: 0, 
          total: 0,
          records: []
        };
      }
      summary[monthYearKey].count += 1;
      summary[monthYearKey].total += record.total;
      summary[monthYearKey].records.push(record);
    });
    return summary;
  }, [xmlRecords]);

  // Abrir Modal de Calendario del Mes seleccionado
  const handleOpenMonthCalendar = (monthData) => {
    setSelectedMonthModal(monthData);
    setSelectedDayDetails(null);
  };

  // Mapeo preciso del calendario según el día exacto del mes de emisión de la factura
  const monthCalendarGrid = useMemo(() => {
    if (!selectedMonthModal || selectedMonthModal.key === 'sin-fecha') return null;

    const { year, monthIndex, records } = selectedMonthModal;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const firstDayIndex = new Date(year, monthIndex, 1).getDay(); // 0 = Domingo, 4 = Jueves, etc.

    // Inicializar los días del mes
    const daysData = {};
    for (let day = 1; day <= daysInMonth; day++) {
      daysData[day] = [];
    }

    // Clasificar facturas en su número de día exacto
    records.forEach(rec => {
      const recDate = parseLocalDate(rec.fecha);
      if (recDate && recDate.getFullYear() === year && recDate.getMonth() === monthIndex) {
        const dayNum = recDate.getDate();
        if (daysData[dayNum]) {
          daysData[dayNum].push(rec);
        }
      }
    });

    return { daysInMonth, firstDayIndex, daysData };
  }, [selectedMonthModal]);

  // 5. Exportación a Excel
  const executeExport = () => {
    let dataToExport = [...xmlRecords];

    if (exportOption === 'amountRange') {
      const min = parseFloat(minAmount) || 0;
      const max = parseFloat(maxAmount) || Infinity;
      dataToExport = dataToExport.filter(r => r.total >= min && r.total <= max);
    } else if (exportOption === 'filtered') {
      dataToExport = xmlRecords.filter(r => 
        r.emisorNombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.concepto.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.emisorRfc.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (dataToExport.length === 0) {
      alert('No hay registros que coincidan con el criterio seleccionado.');
      return;
    }

    const exportFormatted = dataToExport.map((item) => ({
      'Folio': item.folio,
      'Fecha Emisión Factura': item.fecha,
      'Fecha/Hora de Carga': item.fechaCarga || 'N/A',
      'RFC Emisor': item.emisorRfc,
      'Nombre Emisor': item.emisorNombre,
      'Concepto / Justificación': item.concepto,
      'Monto Subtotal ($)': item.subtotal,
      'Monto Total ($)': item.total,
      'CURP Beneficiario (INE)': ineData.curp || 'N/A',
      'Clave Elector (INE)': ineData.claveElector || 'N/A',
      'Nombre Beneficiario': ineData.nombreBeneficiario || 'N/A'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportFormatted);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte Gastos');
    XLSX.writeFile(workbook, `Reporte_CFDI_${exportOption}_${Date.now()}.xlsx`);
    
    setShowExportModal(false);
  };

  const filteredRecords = xmlRecords.filter(r => 
    r.emisorNombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.concepto.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.emisorRfc.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="app-viewport">
      <style>{`
        .app-viewport {
          min-height: 100vh;
          background: radial-gradient(circle at top right, #1e1b4b 0%, #0f172a 40%, #020617 100%);
          color: #f8fafc;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          padding-bottom: 3rem;
        }

        .header-bar {
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding: 1.25rem 2rem;
          margin-bottom: 2rem;
          position: sticky;
          top: 0;
          z-index: 40;
        }

        .header-content {
          max-width: 1280px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .brand-logo-container {
          display: flex;
          align-items: center;
          gap: 0.875rem;
        }

        .icon-badge {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(147, 51, 234, 0.2) 100%);
          border: 1px solid rgba(99, 102, 241, 0.3);
          padding: 0.625rem;
          border-radius: 0.75rem;
          color: #38bdf8;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 15px rgba(56, 189, 248, 0.15);
        }

        .brand-title {
          font-size: 1.35rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          background: linear-gradient(to right, #ffffff, #93c5fd);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 0;
          text-transform: uppercase;
        }

        .brand-subtitle {
          font-size: 0.75rem;
          color: #94a3b8;
          margin: 0.15rem 0 0 0;
        }

        .btn-excel {
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: white;
          border: 1px solid rgba(16, 185, 129, 0.4);
          padding: 0.625rem 1.25rem;
          border-radius: 0.625rem;
          font-weight: 600;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
        }

        .btn-excel:hover {
          transform: translateY(-2px);
          filter: brightness(1.08);
        }

        .main-container {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 1.5rem;
        }

        .cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
        }

        .glass-card {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 1rem;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding-bottom: 0.75rem;
          margin-bottom: 0.75rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .card-title {
          font-size: 0.85rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #e2e8f0;
          margin: 0;
        }

        .card-desc {
          font-size: 0.75rem;
          color: #94a3b8;
          margin-bottom: 1.25rem;
          line-height: 1.4;
        }

        .drop-zone {
          border: 2px dashed rgba(99, 102, 241, 0.3);
          background: rgba(15, 23, 42, 0.4);
          border-radius: 0.75rem;
          padding: 1.75rem 1rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          text-align: center;
          transition: all 0.2s ease;
        }

        .drop-zone:hover {
          border-color: #38bdf8;
          background: rgba(56, 189, 248, 0.05);
        }

        .btn-scan {
          width: 100%;
          background: linear-gradient(135deg, rgba(147, 51, 234, 0.2) 0%, rgba(79, 70, 229, 0.2) 100%);
          border: 1px solid rgba(168, 85, 247, 0.4);
          color: #c084fc;
          padding: 0.75rem;
          border-radius: 0.625rem;
          font-size: 0.8rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          cursor: pointer;
        }

        .input-group {
          margin-top: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .input-field {
          width: 100%;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.75rem;
          color: #f1f5f9;
          font-family: monospace;
        }

        .metric-box {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 0.875rem;
          padding: 1.25rem;
          text-align: center;
          margin: auto 0;
        }

        .metric-number {
          font-size: 3rem;
          font-weight: 900;
          font-family: monospace;
          background: linear-gradient(to bottom, #60a5fa, #2563eb);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          line-height: 1;
          margin: 0.25rem 0;
        }

        .month-summary-card {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 1rem;
          padding: 1.25rem;
          margin-bottom: 2rem;
        }

        .month-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }

        .month-item {
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(59, 130, 246, 0.25);
          border-radius: 0.75rem;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .month-item:hover {
          border-color: #38bdf8;
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(56, 189, 248, 0.15);
        }

        .table-card {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 1rem;
          padding: 1.5rem;
        }

        .table-header-flex {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 1.25rem;
        }

        .search-box {
          position: relative;
          min-width: 280px;
        }

        .search-input {
          width: 100%;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.625rem;
          padding: 0.5rem 0.75rem 0.5rem 2.25rem;
          font-size: 0.75rem;
          color: #f1f5f9;
        }

        .search-icon {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
        }

        .custom-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 0.75rem;
          text-align: left;
        }

        .custom-table th {
          background: rgba(15, 23, 42, 0.9);
          color: #94a3b8;
          text-transform: uppercase;
          font-size: 0.65rem;
          font-weight: 700;
          padding: 0.875rem 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .custom-table td {
          padding: 0.875rem 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          color: #cbd5e1;
        }

        .custom-table tr:hover td {
          background: rgba(51, 65, 85, 0.4);
        }

        .action-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 0.35rem;
          border-radius: 0.375rem;
        }

        .action-btn.edit { color: #60a5fa; }
        .action-btn.edit:hover { background: rgba(96, 165, 250, 0.15); }
        
        .action-btn.delete { color: #f87171; }
        .action-btn.delete:hover { background: rgba(248, 113, 113, 0.15); }

        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(2, 6, 23, 0.8);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }

        .modal-body {
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 1rem;
          width: 100%;
          max-width: 550px;
          padding: 1.5rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
          max-height: 90vh;
          overflow-y: auto;
        }

        .radio-option {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 0.5rem;
          cursor: pointer;
          margin-bottom: 0.5rem;
        }

        .radio-option.selected {
          border-color: #3b82f6;
          background: rgba(59, 130, 246, 0.1);
        }

        /* Estilos del Calendario */
        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 0.35rem;
          margin-top: 1rem;
        }

        .calendar-day-header {
          text-align: center;
          font-size: 0.65rem;
          font-weight: 700;
          color: #94a3b8;
          padding: 0.25rem 0;
          text-transform: uppercase;
        }

        .calendar-day-cell {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 0.5rem;
          min-height: 48px;
          padding: 0.35rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: flex-start;
          transition: all 0.2s ease;
        }

        .calendar-day-cell.active-has-data {
          border-color: rgba(56, 189, 248, 0.5);
          background: rgba(56, 189, 248, 0.12);
        }

        .calendar-day-cell.selected-day {
          border-color: #10b981;
          background: rgba(16, 185, 129, 0.2);
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.25);
        }

        .day-number {
          font-size: 0.75rem;
          font-weight: 700;
          color: #e2e8f0;
        }

        .day-badge {
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: white;
          font-size: 0.55rem;
          font-weight: 700;
          padding: 0.1rem 0.35rem;
          border-radius: 0.35rem;
          align-self: flex-end;
        }
      `}</style>

      {/* Encabezado */}
      <header className="header-bar">
        <div className="header-content">
          <div className="brand-logo-container">
            <div className="icon-badge">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h1 className="brand-title">EXTRACTOR XML</h1>
              <p className="brand-subtitle">Procesamiento de CFDI 4.0 & Identificación OCR para Casa de Gestión</p>
            </div>
          </div>
          <button onClick={() => setShowExportModal(true)} className="btn-excel">
            <FileSpreadsheet size={18} />
            Exportar Reporte Excel (.xlsx)
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-container">
        <div className="cards-grid">
          
          {/* Carga XML */}
          <div className="glass-card">
            <div>
              <div className="card-header">
                <Upload size={18} style={{ color: '#60a5fa' }} />
                <h2 className="card-title">Carga Masiva XML</h2>
              </div>
              <p className="card-desc">
                Arrastre o seleccione los comprobantes fiscales (.xml) que desea incorporar al reporte.
              </p>
            </div>

            <label className="drop-zone">
              <FileText size={32} style={{ color: '#60a5fa', marginBottom: '0.5rem' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f1f5f9' }}>
                {loadingXml ? 'Procesando archivos...' : 'Examinar Comprobantes XML'}
              </span>
              <input type="file" multiple accept=".xml" onChange={handleXmlUpload} style={{ display: 'none' }} />
            </label>
          </div>

          {/* OCR INE */}
          <div className="glass-card">
            <div>
              <div className="card-header">
                <Camera size={18} style={{ color: '#c084fc' }} />
                <h2 className="card-title">Escaneo de INE (OCR)</h2>
              </div>
              <p className="card-desc">
                Cargue la imagen capturada para vincular los datos del beneficiario.
              </p>
            </div>

            <div>
              <label className="btn-scan">
                <Sparkles size={16} />
                <span>{loadingIne ? 'Analizando...' : 'Tomar / Subir Foto INE'}</span>
                <input type="file" accept="image/*" capture="environment" onChange={handleIneScan} style={{ display: 'none' }} />
              </label>

              <div className="input-group">
                <input 
                  type="text" 
                  placeholder="CURP" 
                  value={ineData.curp}
                  onChange={(e) => setIneData({...ineData, curp: e.target.value})}
                  className="input-field"
                />
                <input 
                  type="text" 
                  placeholder="Clave de Elector" 
                  value={ineData.claveElector}
                  onChange={(e) => setIneData({...ineData, claveElector: e.target.value})}
                  className="input-field"
                />
              </div>
            </div>
          </div>

          {/* Métricas */}
          <div className="glass-card">
            <div>
              <div className="card-header">
                <Layers size={18} style={{ color: '#34d399' }} />
                <h2 className="card-title">Métricas de Control</h2>
              </div>
              <p className="card-desc">
                Conteo total de comprobantes procesados en la sesión.
              </p>
            </div>

            <div className="metric-box">
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>
                Comprobantes XML Cargados
              </span>
              <div className="metric-number">{xmlRecords.length}</div>
              <span style={{ fontSize: '0.7rem', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                <CheckCircle2 size={13} /> Registros listos
              </span>
            </div>
          </div>

        </div>

        {/* Resumen por Mes */}
        <div className="month-summary-card">
          <div className="card-header" style={{ marginBottom: 0 }}>
            <Calendar size={18} style={{ color: '#38bdf8' }} />
            <h2 className="card-title">Resumen de Facturación por Mes</h2>
          </div>

          {Object.keys(monthlySummary).length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '1rem', textAlign: 'center' }}>
              Cargue archivos XML para visualizar el total acumulado y desplegar el calendario mensual.
            </p>
          ) : (
            <div className="month-grid">
              {Object.values(monthlySummary).map((data) => (
                <div key={data.key} className="month-item" onClick={() => handleOpenMonthCalendar(data)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>{data.name}</span>
                    <ChevronRight size={16} style={{ color: '#60a5fa' }} />
                  </div>
                  <div style={{ margin: '0.5rem 0' }}>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8', display: 'block' }}>Monto Acumulado:</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#34d399', fontFamily: 'monospace' }}>
                      ${data.total.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN
                    </span>
                  </div>
                  <span style={{ fontSize: '0.65rem', color: '#60a5fa', fontWeight: 500 }}>
                    {data.count} factura(s) • Abrir Calendario
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabla de Resultados */}
        <div className="table-card">
          <div className="table-header-flex">
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
                Facturas Extraídas ({filteredRecords.length})
              </h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                Aparecen registradas la fecha de la factura y el momento exacto de carga al sistema.
              </p>
            </div>

            <div className="search-box">
              <Search size={16} className="search-icon" />
              <input 
                type="text" 
                placeholder="Filtrar por emisor, RFC o concepto..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.06)' }}>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Fecha Emisión Factura</th>
                  <th>Fecha/Hora Carga</th>
                  <th>RFC Emisor</th>
                  <th>Nombre / Razón Social</th>
                  <th>Concepto del Gasto</th>
                  <th style={{ textAlign: 'right' }}>Total ($)</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                      <FileText size={40} style={{ opacity: 0.2, margin: '0 auto 0.5rem auto', display: 'block' }} />
                      No hay comprobantes XML cargados.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => {
                    const parsedDate = parseLocalDate(record.fecha);
                    return (
                      <tr key={record.id}>
                        <td style={{ fontFamily: 'monospace', color: '#60a5fa', fontWeight: 600 }}>{record.folio}</td>
                        <td style={{ fontSize: '0.7rem', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Calendar size={12} style={{ color: '#60a5fa' }} /> {parsedDate ? parsedDate.toLocaleDateString('es-MX') : 'S/F'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.7rem', color: '#38bdf8', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Clock size={12} /> {record.fechaCarga || 'N/A'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace' }}>{record.emisorRfc}</td>
                        <td style={{ fontWeight: 600, color: '#f1f5f9' }}>{record.emisorNombre}</td>
                        <td style={{ maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#94a3b8' }}>
                          {record.concepto}
                        </td>
                        <td style={{ fontFamily: 'monospace', color: '#34d399', fontWeight: 700, textAlign: 'right', fontSize: '0.85rem' }}>
                          ${record.total.toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="action-btn edit" onClick={() => setEditingRecord({...record})} title="Editar registro">
                            <Edit3 size={15} />
                          </button>
                          <button className="action-btn delete" onClick={() => handleDeleteRecord(record.id)} title="Eliminar registro">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* MODAL 1: CALENDARIO DE FACTURAS EMITIDAS */}
      {selectedMonthModal && (
        <div className="modal-overlay">
          <div className="modal-body" style={{ maxWidth: '650px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Calendar size={20} style={{ color: '#38bdf8' }} /> Calendario de {selectedMonthModal.name}
                </h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.7rem', color: '#94a3b8' }}>
                  Las facturas se ubican en el día de emisión señalado en el XML.
                </p>
              </div>
              <button onClick={() => setSelectedMonthModal(null)} className="action-btn"><X size={18} /></button>
            </div>

            {selectedMonthModal.key === 'sin-fecha' ? (
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '1rem 0' }}>
                Los registros de este bloque no cuentan con una fecha de emisión válida registrada en el XML.
              </p>
            ) : monthCalendarGrid && (
              <>
                {/* Cuadrícula de Días de la Semana */}
                <div className="calendar-grid">
                  {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => (
                    <div key={d} className="calendar-day-header">{d}</div>
                  ))}

                  {/* Espacios previos para alinear primer día */}
                  {Array.from({ length: monthCalendarGrid.firstDayIndex }).map((_, idx) => (
                    <div key={`empty-${idx}`} style={{ opacity: 0.15 }} />
                  ))}

                  {/* Días del mes */}
                  {Array.from({ length: monthCalendarGrid.daysInMonth }).map((_, idx) => {
                    const dayNum = idx + 1;
                    const dayRecords = monthCalendarGrid.daysData[dayNum] || [];
                    const hasData = dayRecords.length > 0;
                    const isSelected = selectedDayDetails === dayNum;

                    return (
                      <div 
                        key={`day-${dayNum}`} 
                        className={`calendar-day-cell ${hasData ? 'active-has-data' : ''} ${isSelected ? 'selected-day' : ''}`}
                        onClick={() => hasData ? setSelectedDayDetails(dayNum) : null}
                        style={{ cursor: hasData ? 'pointer' : 'default', opacity: hasData ? 1 : 0.35 }}
                      >
                        <span className="day-number">{dayNum}</span>
                        {hasData && (
                          <span className="day-badge">{dayRecords.length} XML</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Detalle del día exacto seleccionado */}
                {selectedDayDetails && (
                  <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(15,23,42,0.9)', borderRadius: '0.75rem', border: '1px solid rgba(59,130,246,0.3)' }}>
                    <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Calendar size={15} /> Facturas emitidas el día {selectedDayDetails} de {selectedMonthModal.name}
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                      {monthCalendarGrid.daysData[selectedDayDetails]?.map((rec) => (
                        <div key={rec.id} style={{ background: 'rgba(30,41,59,0.7)', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f8fafc' }}>
                              Folio: <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{rec.folio}</span> — {rec.emisorNombre}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                              Concepto: {rec.concepto}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: '#38bdf8', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <Clock size={11} /> Carga al sistema: {rec.fechaCarga || 'N/A'}
                            </div>
                          </div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#34d399', fontFamily: 'monospace', whiteSpace: 'nowrap', marginLeft: '0.75rem' }}>
                            ${rec.total.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button onClick={() => setSelectedMonthModal(null)} className="btn-excel" style={{ background: '#334155', border: '1px solid rgba(255,255,255,0.1)' }}>
                Cerrar Calendario
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: EDICIÓN */}
      {editingRecord && (
        <div className="modal-overlay">
          <div className="modal-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc' }}>Editar Comprobante XML</h3>
              <button onClick={() => setEditingRecord(null)} className="action-btn"><X size={18} /></button>
            </div>
            
            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Folio:</label>
                  <input 
                    type="text" 
                    value={editingRecord.folio} 
                    onChange={(e) => setEditingRecord({...editingRecord, folio: e.target.value})} 
                    className="input-field" 
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Fecha de Emisión (YYYY-MM-DD):</label>
                  <input 
                    type="text" 
                    value={editingRecord.fecha} 
                    onChange={(e) => setEditingRecord({...editingRecord, fecha: e.target.value})} 
                    className="input-field" 
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>RFC Emisor:</label>
                <input 
                  type="text" 
                  value={editingRecord.emisorRfc} 
                  onChange={(e) => setEditingRecord({...editingRecord, emisorRfc: e.target.value})} 
                  className="input-field" 
                />
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Nombre / Razón Social Emisor:</label>
                <input 
                  type="text" 
                  value={editingRecord.emisorNombre} 
                  onChange={(e) => setEditingRecord({...editingRecord, emisorNombre: e.target.value})} 
                  className="input-field" 
                />
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Concepto del Gasto:</label>
                <textarea 
                  rows="3"
                  value={editingRecord.concepto} 
                  onChange={(e) => setEditingRecord({...editingRecord, concepto: e.target.value})} 
                  className="input-field" 
                  style={{ resize: 'none' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Subtotal ($):</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editingRecord.subtotal} 
                    onChange={(e) => setEditingRecord({...editingRecord, subtotal: parseFloat(e.target.value) || 0})} 
                    className="input-field" 
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Total ($):</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editingRecord.total} 
                    onChange={(e) => setEditingRecord({...editingRecord, total: parseFloat(e.target.value) || 0})} 
                    className="input-field" 
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="submit" className="btn-excel" style={{ flex: 1, justifyContent: 'center' }}>
                  <Save size={16} /> Guardar Cambios
                </button>
                <button type="button" onClick={() => setEditingRecord(null)} className="action-btn" style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '0.5rem 1rem' }}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EXPORTACIÓN */}
      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Filter size={18} style={{ color: '#10b981' }} /> Opciones de Exportación
              </h3>
              <button onClick={() => setShowExportModal(false)} className="action-btn"><X size={18} /></button>
            </div>

            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '1rem' }}>
              Seleccione el criterio con el que desea generar la hoja de cálculo en Excel:
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label className={`radio-option ${exportOption === 'all' ? 'selected' : ''}`}>
                <input 
                  type="radio" 
                  name="exportType" 
                  checked={exportOption === 'all'} 
                  onChange={() => setExportOption('all')} 
                />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f1f5f9' }}>Todos los XML ({xmlRecords.length})</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Exporta la totalidad de facturas cargadas.</div>
                </div>
              </label>

              <label className={`radio-option ${exportOption === 'filtered' ? 'selected' : ''}`}>
                <input 
                  type="radio" 
                  name="exportType" 
                  checked={exportOption === 'filtered'} 
                  onChange={() => setExportOption('filtered')} 
                />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f1f5f9' }}>Facturas Filtradas Actuales ({filteredRecords.length})</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Exporta únicamente el resultado del buscador.</div>
                </div>
              </label>

              <label className={`radio-option ${exportOption === 'amountRange' ? 'selected' : ''}`}>
                <input 
                  type="radio" 
                  name="exportType" 
                  checked={exportOption === 'amountRange'} 
                  onChange={() => setExportOption('amountRange')} 
                />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f1f5f9' }}>Filtrar por Rango de Montos ($)</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Exporta sólo las facturas que estén dentro de un límite.</div>
                </div>
              </label>
            </div>

            {exportOption === 'amountRange' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem', padding: '0.75rem', background: 'rgba(15,23,42,0.8)', borderRadius: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Monto Mínimo ($):</label>
                  <input 
                    type="number" 
                    placeholder="0.00" 
                    value={minAmount} 
                    onChange={(e) => setMinAmount(e.target.value)} 
                    className="input-field" 
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Monto Máximo ($):</label>
                  <input 
                    type="number" 
                    placeholder="Sin límite" 
                    value={maxAmount} 
                    onChange={(e) => setMaxAmount(e.target.value)} 
                    className="input-field" 
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button onClick={executeExport} className="btn-excel" style={{ flex: 1, justifyContent: 'center' }}>
                <Download size={16} /> Generar Excel
              </button>
              <button onClick={() => setShowExportModal(false)} className="action-btn" style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '0.5rem 1rem' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}